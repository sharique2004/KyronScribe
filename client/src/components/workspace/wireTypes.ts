// OWNED BY A7. Local wire types that mirror the A7 brief's WIRE CONTRACT
// exactly. The shared `@/types` file carries a slightly different (flatter)
// shape for encounter list/detail; per the brief these adjusted types live in
// a file I own rather than editing the shared module.

import type { IcdCode, NoteContent, RedFlag } from '@/types';

export type { IcdCode, NoteContent, RedFlag };

/** A single immutable note version as returned by GET /api/encounters/:id. */
export interface WireNoteVersion {
  id: string;
  versionNo: number;
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
  icdCodes: IcdCode[];
  redFlags: RedFlag[];
  createdBy: { id: string; fullName: string };
  createdAt: string;
}

/** GET /api/encounters/:id → { encounter } */
export interface WireEncounterDetail {
  id: string;
  createdAt: string;
  occurredOn?: string;
  transcript: string;
  templateId: string | null;
  templateName: string | null;
  provider: { id: string; fullName: string; credentials: string | null };
  patient: { id: string; firstName: string; lastName: string; dob: string; mrn?: string };
  noteId: string;
  versions: WireNoteVersion[]; // newest first
}

/** One row from GET /api/encounters → { encounters } */
export interface WireEncounterListItem {
  id: string;
  createdAt: string;
  occurredOn?: string;
  patient: { id: string; firstName: string; lastName: string; dob: string; mrn?: string };
  templateName: string | null;
  versionCount: number;
  latestVersion: { versionNo: number; icdCodes: IcdCode[]; createdAt: string } | null;
}

/** History event payload (fuels the P3 context-transparency panel). */
export interface HistoryData {
  count: number;
  encounters: Array<{ date: string; provider: string; codes: string[] }>;
}
