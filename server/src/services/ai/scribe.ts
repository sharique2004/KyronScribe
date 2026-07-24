// The live Anthropic streaming loop (PRD §6.1, §6.4, F4). Streams text deltas as SSE `delta`
// events, surfaces the <RED_FLAGS> block the moment it closes, executes the get_patient_history
// tool call mid-generation for returning patients (max 2 API turns), and parses the full text
// into a `complete` note or an `insufficient` event. Mock mode shares the history query + emit
// contract so both paths are identical from the client's perspective.
import Anthropic from '@anthropic-ai/sdk';
import { getConfig } from '../../config.js';
import { query } from '../../db.js';
import { buildSystemPrompt, GET_PATIENT_HISTORY_TOOL } from './prompts.js';
import { parse, parseRedFlags } from './parser.js';

export interface GenerationOpts {
  patient: { first: string; last: string; dob: string };
  transcript: string;
  templatePrompt: string | null;
  templateName: string | null;
  isReturning: boolean;
  patientId: string | null;
  todayIso: string;
  signal: AbortSignal;
  /** Preformatted "practice-learned diagnostic patterns" prompt section, when lessons matched. */
  learnedSection?: string | null;
  /** The matched lessons (for the `learned` SSE event and mock weaving). */
  learnedMeta?: { id: string; revisedDx: string; lessonSummary: string }[];
}

/** SSE event names emitted upstream to the route's write helper (PRD §6.3). */
export type ScribeEvent =
  | 'status'
  | 'red_flags'
  | 'delta'
  | 'history'
  | 'learned'
  | 'insufficient'
  | 'complete'
  | 'error'
  | 'done';

export type Emit = (event: ScribeEvent, data: Record<string, unknown>) => void;

/** One prior-encounter row for the history tool_result / transparency panel. */
export interface HistoryEntry {
  date: string; // ISO
  provider: string;
  codes: string[];
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
}

const TRUNC = 1200;

function truncate(s: string): string {
  return s.length > TRUNC ? `${s.slice(0, TRUNC)}…` : s;
}

/**
 * Fetch the patient's last 5 note versions (most recent first) for history injection.
 * Shared by the real tool executor and the mock so both fabricate from the SAME real rows.
 */
export async function fetchPatientHistory(patientId: string): Promise<HistoryEntry[]> {
  const { rows } = await query<{
    created_at: string;
    provider_name: string;
    subjective: string;
    objective: string;
    assessment: string;
    plan: string;
    icd_codes: unknown;
  }>(
    `SELECT COALESCE(e.occurred_on::timestamptz, nv.created_at) AS created_at,
            u.full_name AS provider_name,
            nv.subjective, nv.objective, nv.assessment, nv.plan, nv.icd_codes
     FROM note_versions nv
     JOIN notes n       ON n.id = nv.note_id
     JOIN encounters e  ON e.id = n.encounter_id
     JOIN users u       ON u.id = e.provider_id
     WHERE e.patient_id = $1
     ORDER BY e.occurred_on DESC, nv.created_at DESC
     LIMIT 5`,
    [patientId],
  );

  return rows.map((r) => {
    let codes: string[] = [];
    const raw = r.icd_codes;
    const arr = typeof raw === 'string' ? safeJsonArray(raw) : Array.isArray(raw) ? raw : [];
    codes = arr
      .map((c) => (c && typeof c === 'object' ? String((c as Record<string, unknown>).code ?? '') : ''))
      .filter(Boolean);
    return {
      // pg returns timestamptz columns as JS Date objects despite the row typing —
      // normalize to an ISO string so downstream .slice()/JSON paths are safe.
      date: new Date(r.created_at).toISOString(),
      provider: r.provider_name,
      codes,
      subjective: truncate(r.subjective ?? ''),
      objective: truncate(r.objective ?? ''),
      assessment: truncate(r.assessment ?? ''),
      plan: truncate(r.plan ?? ''),
    };
  });
}

function safeJsonArray(s: string): unknown[] {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/** Render history rows into the plain-text tool result the model consumes (shared by all providers). */
export function formatHistoryForModel(entries: HistoryEntry[]): string {
  if (entries.length === 0) return 'No prior encounters found for this patient.';
  return entries
    .map((e, i) => {
      const date = e.date.slice(0, 10);
      const codes = e.codes.length ? e.codes.join(', ') : 'none recorded';
      return [
        `Prior encounter ${i + 1} — ${date} (provider: ${e.provider})`,
        `  Subjective: ${e.subjective}`,
        `  Objective: ${e.objective}`,
        `  Assessment: ${e.assessment}`,
        `  Plan: ${e.plan}`,
        `  ICD-10 codes: ${codes}`,
      ].join('\n');
    })
    .join('\n\n');
}

/** Emit history status + transparency events (shared by real + mock paths). */
export function emitHistory(emit: Emit, entries: HistoryEntry[]): void {
  emit('status', {
    message: `Reviewing ${entries.length} prior encounter${entries.length === 1 ? '' : 's'}…`,
  });
  emit('history', {
    count: entries.length,
    encounters: entries.map((e) => ({ date: e.date, provider: e.provider, codes: e.codes })),
  });
}

/**
 * Run a live generation against the Anthropic API, emitting SSE events through `emit`.
 * Always terminates by emitting `done` (unless aborted, where the route tears down the stream).
 */
export async function runGeneration(opts: GenerationOpts, emit: Emit): Promise<void> {
  const cfg = getConfig();
  const client = new Anthropic({ apiKey: cfg.anthropicApiKey });

  const system = buildSystemPrompt({
    templatePrompt: opts.templatePrompt,
    patient: opts.patient,
    todayIso: opts.todayIso,
    isReturning: opts.isReturning,
    learnedSection: opts.learnedSection ?? null,
  });

  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: `Encounter transcript:\n\n${opts.transcript}` },
  ];

  // Only offer the tool to returning patients (differential behaviour is structural).
  const offerTools = opts.isReturning && !!opts.patientId;

  let fullText = '';
  let redFlagsEmitted = false;

  const streamTurn = async (withTools: boolean): Promise<Anthropic.Message> => {
    const stream = client.messages.stream(
      {
        model: cfg.scribeModel,
        max_tokens: 3000,
        system,
        messages,
        ...(withTools ? { tools: [GET_PATIENT_HISTORY_TOOL] } : {}),
      },
      { signal: opts.signal },
    );

    stream.on('text', (delta: string) => {
      fullText += delta;
      emit('delta', { text: delta });
      if (!redFlagsEmitted && /<\/RED_FLAGS\s*>/i.test(fullText)) {
        redFlagsEmitted = true;
        emit('red_flags', { flags: parseRedFlags(fullText) });
      }
    });

    return stream.finalMessage();
  };

  try {
    // Turn 1
    let msg = await streamTurn(offerTools);

    // Tool-use turn (at most one hop → max 2 API turns total).
    if (offerTools && msg.stop_reason === 'tool_use') {
      const toolUse = msg.content.find(
        (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === 'get_patient_history',
      );
      if (toolUse && opts.patientId) {
        const entries = await fetchPatientHistory(opts.patientId);
        emitHistory(emit, entries);

        messages.push({ role: 'assistant', content: msg.content });
        messages.push({
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: toolUse.id,
              content: formatHistoryForModel(entries),
            },
          ],
        });

        // Turn 2 — write the note (no tools; the model has what it needs).
        msg = await streamTurn(false);
      }
    }

    // Authoritative parse of the full streamed text.
    const result = parse(fullText);
    if (result.kind === 'insufficient') {
      emit('insufficient', { reason: result.reason });
    } else {
      // Ensure red_flags fired even if the closing tag never streamed cleanly.
      if (!redFlagsEmitted) emit('red_flags', { flags: result.note.redFlags });
      emit('complete', { note: result.note });
    }
  } catch (err) {
    if (opts.signal.aborted || err instanceof Anthropic.APIUserAbortError) {
      // Client went away; the route handles teardown. Do not emit into a dead socket.
      return;
    }
    console.error('[scribe] generation error', err);
    const message = err instanceof Error ? err.message : 'Generation failed';
    emit('error', { message });
  } finally {
    if (!opts.signal.aborted) emit('done', {});
  }
}
