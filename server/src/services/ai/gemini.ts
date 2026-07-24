// The live Gemini streaming loop — mirror of the Anthropic runner in scribe.ts (PRD §6.1,
// §6.4, F4) built on @google/genai. Same system prompt, same tag-format output contract,
// same get_patient_history tool (translated to a Gemini functionDeclaration and offered only
// to returning patients), same SSE event sequence (status → [status+history on tool call] →
// deltas with mid-stream red_flags → complete/insufficient → done), same AbortSignal handling,
// max 2 model turns. Provider choice happens in the route; this module owns only Gemini.
import {
  GoogleGenAI,
  ApiError,
  FunctionCallingConfigMode,
  ThinkingLevel,
  Type,
  type Content,
  type FunctionDeclaration,
  type Part,
} from '@google/genai';
import { getConfig } from '../../config.js';
import { buildSystemPrompt, GET_PATIENT_HISTORY_TOOL } from './prompts.js';
import { parse, parseRedFlags } from './parser.js';
import {
  fetchPatientHistory,
  emitHistory,
  formatHistoryForModel,
  type GenerationOpts,
  type Emit,
} from './scribe.js';

/**
 * The get_patient_history tool translated to a Gemini functionDeclaration. Name and
 * description are shared with the Anthropic definition (single source of truth in
 * prompts.ts); only the schema encoding differs (Gemini's Type enum vs JSON Schema).
 */
const HISTORY_FUNCTION: FunctionDeclaration = {
  name: GET_PATIENT_HISTORY_TOOL.name,
  description: GET_PATIENT_HISTORY_TOOL.description,
  parameters: {
    type: Type.OBJECT,
    properties: {
      patient_id: {
        type: Type.STRING,
        description: 'The clinical database id of the patient whose history to retrieve.',
      },
    },
    required: ['patient_id'],
  },
};

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}

/** Free-tier keys hit per-minute quotas readily; detect 429/RESOURCE_EXHAUSTED shapes. */
function isRateLimitError(err: unknown): boolean {
  if (err instanceof ApiError && err.status === 429) return true;
  return err instanceof Error && /\b429\b|RESOURCE_EXHAUSTED|quota/i.test(err.message);
}

/**
 * Run a live generation against the Gemini API, emitting SSE events through `emit`.
 * Always terminates by emitting `done` (unless aborted, where the route tears down the stream).
 */
export async function runGeminiGeneration(opts: GenerationOpts, emit: Emit): Promise<void> {
  const cfg = getConfig();
  const ai = new GoogleGenAI({ apiKey: cfg.geminiApiKey });

  const system = buildSystemPrompt({
    templatePrompt: opts.templatePrompt,
    patient: opts.patient,
    todayIso: opts.todayIso,
    isReturning: opts.isReturning,
  });

  const contents: Content[] = [
    { role: 'user', parts: [{ text: `Encounter transcript:\n\n${opts.transcript}` }] },
  ];

  // Only offer the tool to returning patients (differential behaviour is structural).
  const offerTools = opts.isReturning && !!opts.patientId;

  let fullText = '';
  let redFlagsEmitted = false;

  /**
   * Stream one model turn; returns the raw function-call Parts the model emitted.
   * We keep whole Parts (not just `chunk.functionCalls`) because Gemini 3 attaches a
   * `thoughtSignature` to the functionCall part, and the API rejects a follow-up turn
   * whose echoed functionCall is missing it.
   */
  const streamTurn = async (withTools: boolean): Promise<Part[]> => {
    const stream = await ai.models.generateContentStream({
      model: cfg.scribeModel,
      contents,
      config: {
        systemInstruction: system,
        maxOutputTokens: 3000,
        abortSignal: opts.signal,
        // Gemini 3-class models think at HIGH by default, which delays the first streamed
        // delta noticeably. The scribe's task is structured extraction — LOW keeps output
        // quality while cutting time-to-first-token. 2.5-class models use thinkingBudget
        // instead, so only apply the knob where it is valid.
        ...(/^gemini-3/.test(cfg.scribeModel)
          ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } }
          : {}),
        ...(withTools
          ? {
              tools: [{ functionDeclarations: [HISTORY_FUNCTION] }],
              toolConfig: {
                functionCallingConfig: { mode: FunctionCallingConfigMode.AUTO },
              },
            }
          : {}),
      },
    });

    const fcParts: Part[] = [];
    for await (const chunk of stream) {
      const delta = chunk.text;
      if (delta) {
        fullText += delta;
        emit('delta', { text: delta });
        if (!redFlagsEmitted && /<\/RED_FLAGS\s*>/i.test(fullText)) {
          redFlagsEmitted = true;
          emit('red_flags', { flags: parseRedFlags(fullText) });
        }
      }
      for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
        if (part.functionCall) fcParts.push(part);
      }
    }
    return fcParts;
  };

  try {
    // Turn 1
    const fcParts = await streamTurn(offerTools);

    // Tool-use turn (at most one hop → max 2 model turns total).
    if (offerTools && fcParts.length > 0) {
      const callPart = fcParts.find((p) => p.functionCall?.name === GET_PATIENT_HISTORY_TOOL.name);
      const call = callPart?.functionCall;
      if (callPart && call && opts.patientId) {
        const entries = await fetchPatientHistory(opts.patientId);
        emitHistory(emit, entries);

        // Echo the model's functionCall part verbatim (thoughtSignature included).
        contents.push({ role: 'model', parts: [callPart] });
        contents.push({
          role: 'user',
          parts: [
            {
              functionResponse: {
                ...(call.id ? { id: call.id } : {}),
                name: GET_PATIENT_HISTORY_TOOL.name,
                response: { result: formatHistoryForModel(entries) },
              },
            },
          ],
        });

        // Turn 2 — write the note (no tools; the model has what it needs).
        await streamTurn(false);
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
    if (opts.signal.aborted || isAbortError(err)) {
      // Client went away; the route handles teardown. Do not emit into a dead socket.
      return;
    }
    console.error('[gemini] generation error', err);
    // Friendly, human-readable message for quota exhaustion (common on free-tier keys);
    // the client re-enables the Generate button on any `error` event, so this is retryable.
    const message = isRateLimitError(err)
      ? 'The AI service is rate-limited right now — try again in a minute.'
      : err instanceof Error
        ? err.message
        : 'Generation failed';
    emit('error', { message });
  } finally {
    if (!opts.signal.aborted) emit('done', {});
  }
}
