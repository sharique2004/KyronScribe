// Tolerant parser for the tagged scribe output (PRD §6.2). The client renders progressively
// from the raw deltas; the server re-parses the FULL text here authoritatively for the
// `complete` / `insufficient` events. Robust to malformed, missing, or unclosed tags.
import type { NoteContent, RedFlag, IcdCodeRef, RedFlagSeverity } from '../../types.js';

export type ParseResult =
  | { kind: 'insufficient'; reason: string }
  | { kind: 'note'; note: NoteContent };

// Order of all opening tags as they appear in the contract — used to bound an unclosed tag:
// content runs from the open tag to the NEXT open tag (or end of text).
const TAG_ORDER = ['RED_FLAGS', 'SUBJECTIVE', 'OBJECTIVE', 'ASSESSMENT', 'CODES', 'PLAN'] as const;

/**
 * Extract the inner content for a tag. Prefers a properly closed `<TAG>…</TAG>`; if the close
 * is missing, takes everything from the open tag to the next known open tag (or end of string).
 */
function extractTag(text: string, tag: string): string | null {
  const openRe = new RegExp(`<${tag}\\s*>`, 'i');
  const openMatch = openRe.exec(text);
  if (!openMatch) return null;
  const contentStart = openMatch.index + openMatch[0].length;

  // Proper close?
  const closeRe = new RegExp(`</${tag}\\s*>`, 'i');
  closeRe.lastIndex = contentStart;
  const rest = text.slice(contentStart);
  const closeMatch = closeRe.exec(rest);
  if (closeMatch) {
    return rest.slice(0, closeMatch.index).trim();
  }

  // Unclosed: cut at the next known opening tag after this one.
  let cut = rest.length;
  for (const other of TAG_ORDER) {
    if (other.toLowerCase() === tag.toLowerCase()) continue;
    const m = new RegExp(`<${other}\\s*>`, 'i').exec(rest);
    if (m && m.index < cut) cut = m.index;
  }
  return rest.slice(0, cut).trim();
}

/** Parse a JSON array out of a tag body; return [] on any malformation (never throw). */
function parseJsonArray(raw: string | null): unknown[] {
  if (!raw) return [];
  const trimmed = raw.trim();
  if (!trimmed) return [];
  // Isolate the outermost [...] in case the model added stray characters around it.
  const start = trimmed.indexOf('[');
  const end = trimmed.lastIndexOf(']');
  const candidate = start !== -1 && end > start ? trimmed.slice(start, end + 1) : trimmed;
  try {
    const parsed = JSON.parse(candidate);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizeCodes(items: unknown[]): IcdCodeRef[] {
  const out: IcdCodeRef[] = [];
  for (const item of items) {
    if (item && typeof item === 'object') {
      const rec = item as Record<string, unknown>;
      const code = typeof rec.code === 'string' ? rec.code.trim() : '';
      const description = typeof rec.description === 'string' ? rec.description.trim() : '';
      if (code) out.push({ code, description });
    }
  }
  return out;
}

function normalizeRedFlags(items: unknown[]): RedFlag[] {
  const out: RedFlag[] = [];
  for (const item of items) {
    if (item && typeof item === 'object') {
      const rec = item as Record<string, unknown>;
      const text = typeof rec.text === 'string' ? rec.text.trim() : '';
      if (!text) continue;
      const sevRaw = typeof rec.severity === 'string' ? rec.severity.toLowerCase() : 'moderate';
      const severity: RedFlagSeverity = sevRaw === 'high' ? 'high' : 'moderate';
      out.push({ severity, text });
    }
  }
  return out;
}

/** Parse just the red-flags block (used mid-stream once `</RED_FLAGS>` arrives). */
export function parseRedFlags(fullText: string): RedFlag[] {
  return normalizeRedFlags(parseJsonArray(extractTag(fullText, 'RED_FLAGS')));
}

/**
 * Authoritative parse of the complete model output. If `<INSUFFICIENT>` is present (and no real
 * SOAP content) → insufficient. Otherwise a NoteContent with graceful defaults for missing tags.
 * Guarantees the note structure is always well-formed; leaves `icdCodes` [] when the model
 * omitted <CODES> (never invents codes).
 */
export function parse(fullText: string): ParseResult {
  const text = fullText ?? '';

  const insufficient = extractTag(text, 'INSUFFICIENT');
  const subjective = extractTag(text, 'SUBJECTIVE');
  const objective = extractTag(text, 'OBJECTIVE');
  const assessment = extractTag(text, 'ASSESSMENT');
  const plan = extractTag(text, 'PLAN');

  const hasAnyProse = [subjective, objective, assessment, plan].some(
    (s) => s !== null && s.trim().length > 0,
  );

  if (insufficient !== null && !hasAnyProse) {
    const reason = insufficient.trim() || 'No clinically meaningful content was identified in the transcript.';
    return { kind: 'insufficient', reason };
  }

  const note: NoteContent = {
    subjective: subjective ?? '',
    objective: objective && objective.trim() ? objective : 'Not documented during this encounter.',
    assessment: assessment ?? '',
    plan: plan ?? '',
    icdCodes: normalizeCodes(parseJsonArray(extractTag(text, 'CODES'))),
    redFlags: normalizeRedFlags(parseJsonArray(extractTag(text, 'RED_FLAGS'))),
  };

  return { kind: 'note', note };
}
