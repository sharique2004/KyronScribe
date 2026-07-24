// OWNED BY A8 — admin-only wire shapes (PRD §5, §7.3).
// The shared '@/types' file (A3) is frozen; the admin endpoints return a few
// shapes not present there, so we type them here against the Wave-2 wire
// contract exactly.

import type { IcdCode, RedFlag } from '@/types';

/** GET /api/admin/encounters row. */
export interface AdminEncounterRow {
  id: string;
  createdAt: string;
  occurredOn?: string;
  provider: { id: string; fullName: string };
  patient: { firstName: string; lastName: string; dob: string; mrn?: string };
  templateName: string | null;
  versionCount: number;
  latestVersion: { versionNo: number; icdCodes: IcdCode[] } | null;
}

export interface AdminEncountersResponse {
  encounters: AdminEncounterRow[];
}

/**
 * GET /api/admin/providers row. `role` is not in the frozen wire contract but
 * is read defensively so admin rows can be badged and shielded from the
 * deactivate control when the backend does include it.
 */
export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

export interface AdminProviderRow {
  id: string;
  email: string;
  fullName: string;
  credentials: string | null;
  isActive: boolean;
  createdAt: string;
  deactivatedAt: string | null;
  encounterCount: number;
  role?: 'provider' | 'admin';
  /**
   * Wave-2 wire contract: signup lifecycle. Existing seeded rows may omit it
   * (treated as already-approved roster members), so it's optional.
   */
  approvalStatus?: ApprovalStatus;
}

export interface AdminProvidersResponse {
  providers: AdminProviderRow[];
}

export interface AdminProviderMutationResponse {
  provider: AdminProviderRow;
}

/** GET /api/admin/templates row. */
export interface AdminTemplate {
  id: string;
  name: string;
  description: string | null;
  prompt: string;
  createdAt: string;
  updatedAt: string;
}

export interface AdminTemplatesResponse {
  templates: AdminTemplate[];
}

export interface AdminTemplateMutationResponse {
  template: AdminTemplate;
}

// --- Read-only note view (GET /api/encounters/:id) ---

export interface AdminNoteVersion {
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

export interface AdminEncounterDetail {
  id: string;
  createdAt: string;
  transcript: string;
  templateId: string | null;
  templateName: string | null;
  provider: { id: string; fullName: string; credentials: string | null };
  patient: { id: string; firstName: string; lastName: string; dob: string };
  noteId: string;
  versions: AdminNoteVersion[];
}

export interface AdminEncounterDetailResponse {
  encounter: AdminEncounterDetail;
}
