// Mock scribe (PRD §2.2 P5, F9/N1). Streams a realistic, tag-formatted generation through the
// IDENTICAL SSE path as the real model — status → (history, for returning patients, from the
// ACTUAL prior notes) → red_flags (mid-stream when </RED_FLAGS> closes) → delta chunks → complete
// → done — so the full UX is demoable with no API key. Content is derived from transcript keywords
// and is template-aware. Transcripts with no clinical signal emit `insufficient` instead.
import { parse, parseRedFlags } from './parser.js';
import {
  fetchPatientHistory,
  emitHistory,
  type GenerationOpts,
  type Emit,
  type HistoryEntry,
} from './scribe.js';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// ── Clinical-signal + red-flag heuristics ──────────────────────────────────────
const MEDICAL_KEYWORDS = [
  'pain', 'ache', 'fever', 'cough', 'cold', 'flu', 'nausea', 'vomit', 'diarrhea', 'headache',
  'dizzy', 'dizziness', 'fatigue', 'rash', 'swelling', 'swollen', 'bp', 'blood pressure',
  'hypertension', 'diabetes', 'glucose', 'a1c', 'sugar', 'cholesterol', 'chest', 'breath',
  'sob', 'shortness', 'abdomen', 'abdominal', 'back', 'knee', 'shoulder', 'hip', 'ankle',
  'sprain', 'fracture', 'infection', 'sore throat', 'ear', 'sinus', 'anxiety', 'depression',
  'insomnia', 'medication', 'meds', 'metformin', 'lisinopril', 'follow-up', 'follow up',
  'exam', 'bp', 'vitals', 'weight', 'allergy', 'asthma', 'wheez', 'bleeding', 'burning',
  'urination', 'uti', 'numbness', 'weakness', 'tingling', 'palpitation', 'syncope', 'fainting',
  'diaphoresis', 'sweating', 'radiat', 'edema', 'congestion', 'presents with', 'complains of',
  'reports', 'symptom', 'diagnos', 'prescrib', 'refill', 'dose', 'mg', 'bid', 'prn',
];

interface RedFlagRule {
  test: (t: string) => boolean;
  severity: 'high' | 'moderate';
  text: string;
}

const RED_FLAG_RULES: RedFlagRule[] = [
  {
    test: (t) => /chest\s*pain|chest\s*pressure|chest\s*tightness/.test(t),
    severity: 'high',
    text: 'Chest pain reported — rule out acute coronary syndrome',
  },
  {
    test: (t) => /diaphoresis|cold sweat|sweating profusely|breaking out in a sweat/.test(t),
    severity: 'high',
    text: 'Diaphoresis with cardiac symptoms — emergent evaluation warranted',
  },
  {
    test: (t) => /shortness of breath|short of breath|\bsob\b|dyspnea|can'?t breathe|difficulty breathing/.test(t),
    severity: 'high',
    text: 'Shortness of breath — assess for cardiopulmonary compromise',
  },
  {
    test: (t) => /syncope|fainted|passed out|loss of consciousness|blacked out/.test(t),
    severity: 'high',
    text: 'Syncope / loss of consciousness — cardiac and neuro workup indicated',
  },
  {
    test: (t) => /numbness|facial droop|slurred speech|weakness on one side|focal/.test(t),
    severity: 'high',
    text: 'Possible focal neurologic deficit — rule out stroke',
  },
  {
    test: (t) => /suicidal|self-harm|kill myself|end my life/.test(t),
    severity: 'high',
    text: 'Suicidal ideation reported — immediate psychiatric evaluation',
  },
  {
    test: (t) => /severe bleeding|hemorrhage|vomiting blood|blood in stool|melena/.test(t),
    severity: 'moderate',
    text: 'Signs of significant bleeding — evaluate promptly',
  },
  {
    test: (t) => /high fever|temp(?:erature)? of 10[3-9]|severe (?:pain|abdominal)/.test(t),
    severity: 'moderate',
    text: 'Severe symptoms — urgent assessment recommended',
  },
];

function hasClinicalSignal(transcript: string): boolean {
  const t = transcript.toLowerCase();
  const stripped = t.replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (stripped.length < 15) return false;
  return MEDICAL_KEYWORDS.some((kw) => t.includes(kw));
}

// Drop clauses that are negated ("no chest pain", "denies SOB") so symptom detection doesn't fire
// on explicitly ruled-out findings — a small realism win for the mock.
const NEGATION_CUE = /\b(no|not|without|denies|denied|negative for|absent|nil|none)\b/;

function positiveText(transcript: string): string {
  return transcript
    .toLowerCase()
    .split(/[.;]|\bbut\b/)
    .map((sentence) => {
      // A negation cue negates the remainder of its sentence, including comma/"and"
      // lists ("denies chest pain, SOB, dizziness" must drop all three findings).
      const cue = sentence.match(NEGATION_CUE);
      return cue ? sentence.slice(0, cue.index) : sentence;
    })
    .join('. ');
}

function detectRedFlags(transcript: string): { severity: 'high' | 'moderate'; text: string }[] {
  const t = positiveText(transcript);
  return RED_FLAG_RULES.filter((r) => r.test(t)).map((r) => ({ severity: r.severity, text: r.text }));
}

// ── Deterministic note synthesis from transcript keywords ───────────────────────
interface KeywordCode {
  match: RegExp;
  code: string;
  description: string;
}

const CODE_HINTS: KeywordCode[] = [
  { match: /hypertension|high blood pressure|\bhtn\b|\bbp\b/, code: 'I10', description: 'Essential (primary) hypertension' },
  { match: /diabetes|\bt2dm\b|a1c|blood sugar|glucose|metformin/, code: 'E11.9', description: 'Type 2 diabetes mellitus without complications' },
  { match: /cholesterol|hyperlipidemia|statin|lipid/, code: 'E78.5', description: 'Hyperlipidemia, unspecified' },
  { match: /low back|lower back|back pain|lumbar/, code: 'M54.50', description: 'Low back pain, unspecified' },
  { match: /chest pain|chest pressure|chest tightness/, code: 'R07.9', description: 'Chest pain, unspecified' },
  { match: /shortness of breath|dyspnea|\bsob\b/, code: 'R06.02', description: 'Shortness of breath' },
  { match: /sore throat|pharyngitis|urti|upper respiratory|cold|congestion/, code: 'J06.9', description: 'Acute upper respiratory infection, unspecified' },
  { match: /cough|bronchitis/, code: 'R05.9', description: 'Cough, unspecified' },
  { match: /urinat|dysuria|\buti\b|bladder/, code: 'N39.0', description: 'Urinary tract infection, site not specified' },
  { match: /anxiety|anxious|panic/, code: 'F41.1', description: 'Generalized anxiety disorder' },
  { match: /depress/, code: 'F32.9', description: 'Major depressive disorder, single episode, unspecified' },
  { match: /ankle sprain|sprained ankle|twisted (?:my |his |her )?ankle|ankle/, code: 'S93.409A', description: 'Sprain of unspecified ligament of unspecified ankle, initial encounter' },
  { match: /sprain|strain/, code: 'S93.409A', description: 'Sprain of unspecified ligament of unspecified ankle, initial encounter' },
  { match: /knee/, code: 'M25.561', description: 'Pain in right knee' },
  { match: /shoulder/, code: 'M25.511', description: 'Pain in right shoulder' },
  { match: /headache|migraine/, code: 'R51.9', description: 'Headache, unspecified' },
  { match: /nausea|vomit/, code: 'R11.2', description: 'Nausea with vomiting, unspecified' },
  { match: /fatigue|tired|malaise/, code: 'R53.83', description: 'Other fatigue' },
];

function pickCodes(transcript: string): { code: string; description: string }[] {
  const t = positiveText(transcript);
  const hits = CODE_HINTS.filter((h) => h.match.test(t)).map((h) => ({ code: h.code, description: h.description }));
  // Dedupe by code, keep at least one (grading requirement).
  const seen = new Set<string>();
  const out: { code: string; description: string }[] = [];
  for (const h of hits) {
    if (!seen.has(h.code)) {
      seen.add(h.code);
      out.push(h);
    }
  }
  if (out.length === 0) out.push({ code: 'Z00.00', description: 'Encounter for general adult medical examination without abnormal findings' });
  return out.slice(0, 4);
}

function firstSentence(transcript: string): string {
  const clean = transcript.replace(/\s+/g, ' ').trim();
  const m = /^(.{0,180}?[.!?])\s/.exec(clean);
  // Strip trailing sentence punctuation — callers add their own period when interpolating.
  return ((m && m[1]) ? m[1] : clean.slice(0, 180)).trim().replace(/[.!?]+$/, '');
}

/**
 * First meaningful directive line of the template's prompt, so mock output visibly
 * changes when an admin edits a template (or creates a custom one) — mirroring how
 * the live model consumes the prompt. Returns null for an empty/missing prompt.
 */
function promptDirective(templatePrompt: string | null | undefined): string | null {
  if (!templatePrompt) return null;
  const line = templatePrompt
    .split('\n')
    .map((l) => l.replace(/^[\s\-*#>•\d.)]+/, '').trim())
    .find((l) => l.length > 0);
  if (!line) return null;
  return line.length > 140 ? `${line.slice(0, 137)}...` : line;
}

/** Build a plausible, template-aware tagged SOAP note derived from the transcript. */
function synthesizeNote(opts: GenerationOpts, history: HistoryEntry[]): string {
  const t = opts.transcript.toLowerCase();
  const flags = detectRedFlags(opts.transcript);
  const codes = pickCodes(opts.transcript);
  const tname = (opts.templateName ?? 'General SOAP').trim();

  const hpi = firstSentence(opts.transcript);
  const mostRecent = history[0];
  const priorLine = mostRecent
    ? ` Prior encounters on file (${history.length}); most recent addressed ${
        mostRecent.codes[0] ?? 'ongoing issues'
      }.`
    : '';

  const subjective = `Patient presents reporting: ${hpi}. Symptoms and concerns as documented in the encounter transcript.${priorLine}`;

  const hasObjective = /\bbp\b|blood pressure|\d+\/\d+|heart rate|\bhr\b|temp|exam|palpat|auscultat|\d+\s*bpm|weight|vitals|tender|swelling|range of motion|\brom\b/.test(t);
  let objective: string;
  if (!hasObjective) {
    objective = 'Not documented during this encounter.';
  } else if (/orthopedic|ortho|msk|follow-up/i.test(tname)) {
    objective = 'Focused MSK exam per transcript: inspection, range of motion, strength, and gait assessed as described. Vitals as stated.';
  } else {
    objective = 'Exam and vital signs as documented in the transcript.';
  }

  const styleNote = /urgent/i.test(tname)
    ? ' Disposition and explicit return precautions prioritized per urgent-care workflow.'
    : /new patient/i.test(tname)
      ? ' Comprehensive assessment with broadened differential per new-patient evaluation.'
      : '';

  // Self-improving loop: weave retrieved practice lessons into the differential so the
  // demo visibly changes once a diagnostic-revision lesson exists (mirrors the live prompt).
  const learned = opts.learnedMeta ?? [];
  const learnedLine = learned.length
    ? ` Per practice-learned diagnostic pattern${learned.length > 1 ? 's' : ''}, also consider: ${learned
        .map((l) => l.revisedDx)
        .join('; ')} — discriminating features reviewed.`
    : '';

  const assessment = `Clinical impression based on the presentation${
    codes.length ? `: ${codes.map((c, i) => `${i + 1}. ${c.description} (${c.code})`).join('; ')}` : ''
  }.${learnedLine}${styleNote}`;

  const followUp = history.length > 0 ? 'Continue established management; ' : '';
  const returnPrec = /urgent/i.test(tname) ? 'Return precautions reviewed. ' : '';
  // Echo the active template's leading directive so edits to the prompt (and custom
  // templates that match no name heuristic) visibly change the generated note.
  const directive = promptDirective(opts.templatePrompt);
  const templateLine = directive
    ? ` Documented per the "${tname}" template guidance: ${directive}${/[.!?]$/.test(directive) ? '' : '.'}`
    : '';
  const plan = `${followUp}${returnPrec}Plan per transcript: address the above problem(s), counsel the patient, and arrange appropriate follow-up. Medications and orders as dictated.${templateLine}`;

  return [
    `<RED_FLAGS>${JSON.stringify(flags)}</RED_FLAGS>`,
    `<SUBJECTIVE>${subjective}</SUBJECTIVE>`,
    `<OBJECTIVE>${objective}</OBJECTIVE>`,
    `<ASSESSMENT>${assessment}</ASSESSMENT>`,
    `<CODES>${JSON.stringify(codes)}</CODES>`,
    `<PLAN>${plan}</PLAN>`,
  ].join('\n');
}

/** Stream `text` as small delta chunks, watching for the red-flags close tag like the real path. */
async function streamText(
  text: string,
  emit: Emit,
  signal: AbortSignal,
  onRedFlagClose: () => void,
): Promise<void> {
  let acc = '';
  let redFlagsSeen = false;
  let i = 0;
  while (i < text.length) {
    if (signal.aborted) return;
    const size = 5 + Math.floor(Math.random() * 16); // 5–20 chars
    const chunk = text.slice(i, i + size);
    i += size;
    acc += chunk;
    emit('delta', { text: chunk });
    if (!redFlagsSeen && /<\/RED_FLAGS\s*>/i.test(acc)) {
      redFlagsSeen = true;
      onRedFlagClose();
    }
    await sleep(30 + Math.floor(Math.random() * 30)); // 30–60ms
  }
}

/**
 * Mock generation entry point — identical event contract to `runGeneration`.
 */
export async function runMockGeneration(opts: GenerationOpts, emit: Emit): Promise<void> {
  try {
    emit('status', { message: 'Analyzing transcript…' });
    await sleep(250);

    // No clinical signal → insufficient (N1), streamed through the same path.
    if (!hasClinicalSignal(opts.transcript)) {
      const reason = 'No clinically meaningful content identified in the transcript. Please provide encounter details to document.';
      const text = `<INSUFFICIENT>${reason}</INSUFFICIENT>`;
      await streamText(text, emit, opts.signal, () => {});
      if (opts.signal.aborted) return;
      const result = parse(text);
      if (result.kind === 'insufficient') emit('insufficient', { reason: result.reason });
      else emit('insufficient', { reason });
      return;
    }

    // Returning patient → simulate the tool call from the ACTUAL prior notes.
    let history: HistoryEntry[] = [];
    if (opts.isReturning && opts.patientId) {
      await sleep(300);
      history = await fetchPatientHistory(opts.patientId);
      emitHistory(emit, history);
      await sleep(200);
    }

    const noteText = synthesizeNote(opts, history);
    await streamText(noteText, emit, opts.signal, () => {
      emit('red_flags', { flags: parseRedFlags(noteText) });
    });
    if (opts.signal.aborted) return;

    const result = parse(noteText);
    if (result.kind === 'insufficient') {
      emit('insufficient', { reason: result.reason });
    } else {
      emit('complete', { note: result.note });
    }
  } catch (err) {
    if (opts.signal.aborted) return;
    console.error('[mock] generation error', err);
    const message = err instanceof Error ? err.message : 'Mock generation failed';
    emit('error', { message });
  } finally {
    if (!opts.signal.aborted) emit('done', {});
  }
}
