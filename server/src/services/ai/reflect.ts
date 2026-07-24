// Diagnostic reflection (the "self-improving" half of the lessons loop, PRD-adjacent pioneer).
// Given a prior encounter and a newer one whose diagnosis materially changed, produce a
// structured lesson: what the original presentation contained that pointed to the revised
// diagnosis, what discriminating workup was missing, and a one-paragraph summary suitable
// for retrieval into future generations. Non-streaming; provider-aware (gemini | mock —
// the anthropic path degrades to mock here, reflection is a background enrichment).
import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import { getConfig, effectiveProvider } from '../../config.js';

export interface ReflectionEncounter {
  date: string; // ISO
  transcript: string;
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
  codes: string[]; // ICD-10 codes, primary first
  primaryDescription: string; // description of the primary code (or assessment fallback)
}

export interface ReflectionInput {
  prior: ReflectionEncounter;
  current: ReflectionEncounter;
}

export interface ReflectionOutput {
  initialDx: string;
  revisedDx: string;
  missedSignals: string;
  recommendedWorkup: string;
  lessonSummary: string;
}

const REFLECT_TIMEOUT_MS = 20_000;

const trunc = (s: string, n = 1500): string => (s.length > n ? `${s.slice(0, n)}…` : s);

function reflectionPrompt(input: ReflectionInput): string {
  const enc = (label: string, e: ReflectionEncounter): string =>
    `${label} (${e.date}) — codes: ${e.codes.join(', ') || 'none'}\n` +
    `Transcript: ${trunc(e.transcript)}\n` +
    `Subjective: ${trunc(e.subjective, 800)}\nObjective: ${trunc(e.objective, 500)}\n` +
    `Assessment: ${trunc(e.assessment, 800)}\nPlan: ${trunc(e.plan, 500)}`;

  return `You are a clinical quality-improvement analyst. Between these two encounters for the same patient, the working diagnosis changed from "${input.prior.primaryDescription}" to "${input.current.primaryDescription}".

${enc('EARLIER ENCOUNTER', input.prior)}

${enc('LATER ENCOUNTER (revised diagnosis)', input.current)}

Analyze the diagnostic revision. Respond with ONLY a JSON object (no markdown fences, no commentary):
{
  "initialDx": "short name of the initial working diagnosis",
  "revisedDx": "short name of the revised diagnosis",
  "missedSignals": "2-3 sentences: which features of the ORIGINAL presentation, in retrospect, pointed toward the revised diagnosis, and which discriminating questions or findings were not captured",
  "recommendedWorkup": "1-2 sentences: the focused history questions, exam maneuvers, or tests that would have discriminated the revised diagnosis earlier",
  "lessonSummary": "2-3 sentences, written as forward-looking guidance for future similar presentations in this practice; generalize beyond this specific patient"
}
Be specific and clinical; never invent findings that appear in neither encounter.`;
}

function fallbackFrom(input: ReflectionInput): ReflectionOutput {
  const initialDx = input.prior.primaryDescription;
  const revisedDx = input.current.primaryDescription;
  return {
    initialDx,
    revisedDx,
    missedSignals:
      `The initial encounter was documented as ${initialDx}; the subsequent encounter established ${revisedDx}. ` +
      `Features documented at the later visit were not explored at the first, and no discriminating workup for ${revisedDx} was recorded.`,
    recommendedWorkup:
      `For similar presentations, take a focused history for features of ${revisedDx} and arrange targeted evaluation before anchoring on ${initialDx}.`,
    lessonSummary:
      `When a presentation resembles ${initialDx}, actively consider ${revisedDx} in the differential: ask discriminating questions early, document pertinent negatives, and set a low threshold for re-evaluation if the course does not fit.`,
  };
}

/** Parse the model's JSON (tolerating markdown fences); fall back to the deterministic lesson. */
function parseReflection(text: string, input: ReflectionInput): ReflectionOutput {
  const cleaned = text.replace(/^```(?:json)?/m, '').replace(/```\s*$/m, '').trim();
  try {
    const j = JSON.parse(cleaned) as Partial<ReflectionOutput>;
    const fb = fallbackFrom(input);
    return {
      initialDx: j.initialDx?.trim() || fb.initialDx,
      revisedDx: j.revisedDx?.trim() || fb.revisedDx,
      missedSignals: j.missedSignals?.trim() || fb.missedSignals,
      recommendedWorkup: j.recommendedWorkup?.trim() || fb.recommendedWorkup,
      lessonSummary: j.lessonSummary?.trim() || fb.lessonSummary,
    };
  } catch {
    return fallbackFrom(input);
  }
}

export async function reflectOnRevision(input: ReflectionInput): Promise<ReflectionOutput> {
  const cfg = getConfig();
  if (effectiveProvider(cfg) !== 'gemini') return fallbackFrom(input);

  const ai = new GoogleGenAI({ apiKey: cfg.geminiApiKey });
  const call = ai.models.generateContent({
    model: cfg.scribeModel,
    contents: [{ role: 'user', parts: [{ text: reflectionPrompt(input) }] }],
    config: {
      responseMimeType: 'application/json',
      ...(/^gemini-3/.test(cfg.scribeModel)
        ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } }
        : {}),
    },
  });
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('reflection timed out')), REFLECT_TIMEOUT_MS),
  );
  try {
    const res = await Promise.race([call, timeout]);
    return parseReflection(res.text ?? '', input);
  } catch (err) {
    console.warn('[reflect] live reflection failed, using deterministic fallback:', err);
    return fallbackFrom(input);
  }
}
