// Shared client-side domain types mirroring the server API contract (PRD §4, §5).
// The server owns the authoritative types (server/src/types.ts); these are the
// client's view of the wire shapes.

export type Role = 'provider' | 'admin';

/** The user object returned by /auth/me and /auth/login — never includes the hash. */
export interface SafeUser {
  id: string;
  email: string;
  fullName: string;
  credentials: string | null;
  role: Role;
  isActive: boolean;
  createdAt: string;
}

export interface Patient {
  id: string;
  firstName: string;
  lastName: string;
  dob: string; // ISO date
  createdAt: string;
}

export interface PatientLookup {
  exists: boolean;
  patientId?: string;
  encounterCount: number;
  lastSeen?: string | null;
}

export interface Template {
  id: string;
  name: string;
  description: string | null;
  prompt: string;
  createdAt: string;
  updatedAt: string;
}

export interface IcdCode {
  code: string;
  description: string;
}

export interface IcdSearchResult extends IcdCode {
  score: number;
}

export type RedFlagSeverity = 'high' | 'moderate' | 'low';

export interface RedFlag {
  severity: RedFlagSeverity;
  text: string;
}

/** The four SOAP sections plus the structured artifacts attached to a version. */
export interface NoteContent {
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
  icdCodes: IcdCode[];
  redFlags: RedFlag[];
}

export interface NoteVersion extends NoteContent {
  id: string;
  noteId: string;
  versionNo: number;
  createdBy: string;
  createdByName?: string;
  createdAt: string;
}

export interface EncounterSummary {
  id: string;
  patient: Patient;
  templateName: string | null;
  latestVersionNo: number;
  icdCodes: IcdCode[];
  createdAt: string;
  updatedAt: string;
}

export interface EncounterDetail {
  id: string;
  patient: Patient;
  providerId: string;
  providerName?: string;
  templateId: string | null;
  templateName: string | null;
  transcript: string;
  versions: NoteVersion[];
  createdAt: string;
  updatedAt: string;
}

export interface Draft {
  patientFirst: string;
  patientLast: string;
  patientDob: string | null;
  templateId: string | null;
  transcript: string;
  noteJson: NoteContent | null;
  updatedAt: string;
}

export interface ProviderRosterEntry {
  id: string;
  email: string;
  fullName: string;
  credentials: string | null;
  isActive: boolean;
  encounterCount: number;
  createdAt: string;
}
