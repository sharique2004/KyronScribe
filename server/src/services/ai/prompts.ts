// Prompt architecture for the clinical scribe (PRD §6.2, §6.4).
// The base system prompt encodes the role, fidelity rules, section semantics, the EXACT
// output tag contract, ICD-10 guidance, red-flag criteria, the INSUFFICIENT rule, and
// history-integration guidance. The admin-editable template prompt is appended verbatim
// under "ENCOUNTER TYPE INSTRUCTIONS". Whether the patient is returning changes the tool
// guidance so the differential behaviour is structural, not vibes.
import type { Anthropic } from '@anthropic-ai/sdk';

export interface BuildPromptOpts {
  /** The active template's `prompt` column, or null for the balanced default behaviour. */
  templatePrompt: string | null;
  patient: { first: string; last: string; dob: string };
  /** Today's date, ISO (YYYY-MM-DD), for the patient banner. */
  todayIso: string;
  /** True when a patient record with this identity already exists (has prior encounters). */
  isReturning: boolean;
  /**
   * Preformatted "PRACTICE-LEARNED DIAGNOSTIC PATTERNS" section (self-improving lesson loop),
   * or null when no stored lesson semantically matches this transcript.
   */
  learnedSection?: string | null;
}

/**
 * The `get_patient_history` tool. Offered ONLY for returning patients (F4): the model calls
 * it, the server executes the DB query mid-generation and returns prior notes as a tool_result.
 * History is never injected from the frontend.
 */
export const GET_PATIENT_HISTORY_TOOL: Anthropic.Tool = {
  name: 'get_patient_history',
  description:
    "Returns the patient's prior encounter notes from the clinical database (most recent first: " +
    'date, provider, the Subjective/Objective/Assessment/Plan text, and ICD-10 codes). ' +
    'ALWAYS call this exactly once before writing the note when a patient_id is provided, so the ' +
    'note can reference relevant prior diagnoses, trends, and treatments. Do not fabricate history — ' +
    'use only what this tool returns.',
  input_schema: {
    type: 'object',
    properties: {
      patient_id: {
        type: 'string',
        description: 'The clinical database id of the patient whose history to retrieve.',
      },
    },
    required: ['patient_id'],
  },
};

const BASE_RULES = `You are an expert clinical scribe at Kyron Medical. You convert a raw clinician-dictated encounter transcript into a precise, professional SOAP note. You write in a concise clinical register using standard medical abbreviations (e.g. HTN, T2DM, SOB, BID, PRN, ROM).

FIDELITY RULES (non-negotiable):
- Document ONLY what is supported by the transcript. Never invent findings, vital signs, lab values, medications, doses, diagnoses, or history.
- Do not editorialize or add reassurance that the clinician did not state.
- Preserve clinically meaningful specifics (laterality, duration, severity, quoted values) exactly as given.
- If information for a section is absent, say so plainly rather than guessing.

SECTION SEMANTICS:
- SUBJECTIVE: the patient's reported complaints, history of present illness, relevant review of systems, and pertinent past/family/social history explicitly mentioned. Written in clinical prose.
- OBJECTIVE: examiner-observed findings only — vitals, physical exam, and results actually stated in the transcript. If the transcript contains no objective findings, write exactly: "Not documented during this encounter." NEVER invent vitals or exam findings to fill this section.
- ASSESSMENT: the clinician's clinical impression / differential, tied to the subjective and objective evidence. Number problems when there is more than one.
- PLAN: management for each problem — orders, medications with dosing if stated, referrals, patient education, follow-up, and return precautions when warranted.

ICD-10 SELECTION (the <CODES> block):
- Propose the ICD-10-CM codes best supported by the assessment. Choose the MOST SPECIFIC code the transcript justifies (correct laterality/type/acuity); do not over-specify beyond the evidence.
- Provide at least one code. Each entry is {"code","description"} with the official-style description. Do not include codes for problems not addressed this encounter.
- The provider verifies and may add codes via the ICD widget — propose, do not certify.

RED FLAGS (the <RED_FLAGS> block, emitted FIRST):
- Scan for life-, limb-, or time-critical concerns implied by the transcript: e.g. chest pain with diaphoresis/radiation, shortness of breath, syncope, focal neuro deficit, suicidal ideation, sepsis signs, severe/uncontrolled vitals, anaphylaxis, GI bleed.
- severity is "high" (immediate/emergent) or "moderate" (urgent, needs prompt attention). text is a short specific phrase (e.g. "Chest pain with diaphoresis — rule out ACS").
- If there are none, emit an empty array: <RED_FLAGS>[]</RED_FLAGS>.

OUTPUT CONTRACT — emit EXACTLY these tags in this order and nothing else (no preamble, no markdown, no commentary outside the tags):
<RED_FLAGS>[{"severity":"high","text":"..."}]</RED_FLAGS>
<SUBJECTIVE>...</SUBJECTIVE>
<OBJECTIVE>...</OBJECTIVE>
<ASSESSMENT>...</ASSESSMENT>
<CODES>[{"code":"I10","description":"Essential (primary) hypertension"}]</CODES>
<PLAN>...</PLAN>

The <RED_FLAGS> and <CODES> blocks contain ONLY a valid JSON array (no trailing text inside the tag). The prose sections contain plain text.

INSUFFICIENT RULE:
- If the transcript has no clinically meaningful content (e.g. empty, gibberish, or unrelated chatter with nothing to document), output ONLY:
<INSUFFICIENT>brief professional reason</INSUFFICIENT>
and emit none of the other tags. Never hallucinate a note to fill the gap.`;

const HISTORY_GUIDANCE = `HISTORY INTEGRATION (returning patient):
- This patient has prior encounters. ALWAYS call get_patient_history (once) BEFORE writing the note.
- Weave relevant prior diagnoses, trends, and treatments into the note where clinically appropriate — e.g. "BP improved from 152/94 at last visit" or "continue metformin started at prior visit". Reference history only where it bears on today's encounter; do not restate the entire chart.`;

const FIRST_VISIT_GUIDANCE = `HISTORY INTEGRATION (first visit):
- This is a first visit — no prior history exists for this patient. Do NOT call any tools. Document only today's encounter.`;

/** Assemble the full system prompt for a generation request. */
export function buildSystemPrompt(opts: BuildPromptOpts): string {
  const { templatePrompt, patient, todayIso, isReturning, learnedSection } = opts;

  const banner = `PATIENT: ${patient.first} ${patient.last} · DOB ${patient.dob} · Encounter date ${todayIso}`;

  const templateSection = templatePrompt && templatePrompt.trim()
    ? `ENCOUNTER TYPE INSTRUCTIONS (follow these in addition to the base rules; they shape emphasis and structure, they do not override the fidelity rules or the output contract):\n${templatePrompt.trim()}`
    : `ENCOUNTER TYPE INSTRUCTIONS: General SOAP — balanced, standard documentation across all four sections.`;

  const historySection = isReturning ? HISTORY_GUIDANCE : FIRST_VISIT_GUIDANCE;

  const sections = [BASE_RULES, historySection];
  if (learnedSection && learnedSection.trim()) sections.push(learnedSection.trim());
  sections.push(templateSection, banner);
  return sections.join('\n\n');
}
