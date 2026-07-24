// OWNED BY A7. Incremental parser over the concatenated `delta` text stream
// (PRD §6.2). The model emits tagged sections:
//   <RED_FLAGS>[…]</RED_FLAGS><SUBJECTIVE>…</SUBJECTIVE><OBJECTIVE>…</OBJECTIVE>
//   <ASSESSMENT>…</ASSESSMENT><CODES>[…]</CODES><PLAN>…</PLAN>
// or, when there is no clinical content, only <INSUFFICIENT>reason</INSUFFICIENT>.
//
// This routes S/O/A/P text into their cards live (token-by-token) and reports
// which section is currently open (for the streaming caret). RED_FLAGS and
// CODES bodies are captured but NOT surfaced as note text — those chips arrive
// via the dedicated `red_flags` and `complete` events. A partial tag arriving
// mid-token (e.g. "<SUBJ") is held back so raw '<' fragments never render.

export type SoapKey = 'subjective' | 'objective' | 'assessment' | 'plan';

type TagName =
  | 'RED_FLAGS'
  | 'SUBJECTIVE'
  | 'OBJECTIVE'
  | 'ASSESSMENT'
  | 'CODES'
  | 'PLAN'
  | 'INSUFFICIENT';

const TAGS: TagName[] = [
  'RED_FLAGS',
  'SUBJECTIVE',
  'OBJECTIVE',
  'ASSESSMENT',
  'CODES',
  'PLAN',
  'INSUFFICIENT',
];

const SOAP_OF: Partial<Record<TagName, SoapKey>> = {
  SUBJECTIVE: 'subjective',
  OBJECTIVE: 'objective',
  ASSESSMENT: 'assessment',
  PLAN: 'plan',
};

export interface ParsedStream {
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
  insufficient: string | null;
  /** The S/O/A/P section currently being written, for the live caret. */
  active: SoapKey | null;
}

/** True if `frag` (which starts with '<') could still become a known tag. */
function isTagPrefix(frag: string): boolean {
  // e.g. "<", "</", "<SUBJ", "</PLA" — uppercase letters/underscore only.
  return /^<\/?[A-Z_]*$/.test(frag);
}

/** Parse the full accumulated delta text into progressive section state. */
export function parseSoapStream(raw: string): ParsedStream {
  const out: ParsedStream = {
    subjective: '',
    objective: '',
    assessment: '',
    plan: '',
    insufficient: null,
    active: null,
  };

  let current: TagName | null = null;

  const append = (text: string) => {
    if (!current) return; // text outside any known tag (whitespace between tags)
    const key = SOAP_OF[current];
    if (key) out[key] += text;
    else if (current === 'INSUFFICIENT') out.insufficient = (out.insufficient ?? '') + text;
    // RED_FLAGS / CODES bodies are intentionally discarded here.
  };

  let i = 0;
  while (i < raw.length) {
    const lt = raw.indexOf('<', i);
    if (lt === -1) {
      append(raw.slice(i));
      break;
    }
    if (lt > i) append(raw.slice(i, lt));

    const gt = raw.indexOf('>', lt);
    if (gt === -1) {
      // Trailing partial: hold if it looks like a tag, otherwise it's literal.
      const frag = raw.slice(lt);
      if (!isTagPrefix(frag)) append(frag);
      break;
    }

    const inner = raw.slice(lt + 1, gt);
    const isClose = inner.startsWith('/');
    const name = (isClose ? inner.slice(1) : inner).trim().toUpperCase();

    if ((TAGS as string[]).includes(name)) {
      if (isClose) {
        if (current === name) current = null;
      } else {
        current = name as TagName;
      }
      i = gt + 1;
    } else {
      // Not a known tag — emit just the '<' as literal and resume scanning at the
      // next char. Slicing to gt+1 here would let a stray '<' in prose (e.g.
      // "BP <140/90") swallow a following REAL tag's '>' and render it raw.
      append('<');
      i = lt + 1;
    }
  }

  if (current && SOAP_OF[current]) out.active = SOAP_OF[current] ?? null;
  return out;
}
