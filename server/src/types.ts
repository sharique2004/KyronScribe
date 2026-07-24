// Shared domain types for the Kyron Scribe backend.
// Application-facing shapes are camelCase; DB rows (snake_case) are mapped at the query boundary.
import type { Request } from 'express';

export type UserRole = 'provider' | 'admin';

/** Full user record as stored, including the bcrypt hash. Never serialized to a client. */
export interface User {
  id: string;
  email: string;
  passwordHash: string;
  fullName: string;
  credentials: string | null;
  role: UserRole;
  isActive: boolean;
  createdAt: string;
  deactivatedAt: string | null;
}

/** Client-safe projection of a user — the exact columns the auth middleware selects. */
export interface SafeUser {
  id: string;
  email: string;
  fullName: string;
  credentials: string | null;
  role: UserRole;
  isActive: boolean;
}

export interface Patient {
  id: string;
  firstName: string;
  lastName: string;
  dob: string; // ISO date (YYYY-MM-DD)
  createdAt: string;
}

export interface Template {
  id: string;
  name: string;
  description: string | null;
  prompt: string;
  isDeleted: boolean;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Encounter {
  id: string;
  patientId: string;
  providerId: string;
  templateId: string | null;
  transcript: string;
  createdAt: string;
  updatedAt: string;
}

/** 1:1 anchor for an encounter's append-only version chain. */
export interface Note {
  id: string;
  encounterId: string;
  createdAt: string;
}

export interface NoteVersion {
  id: string;
  noteId: string;
  versionNo: number;
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
  icdCodes: IcdCodeRef[];
  redFlags: RedFlag[];
  createdBy: string;
  createdAt: string;
}

export interface Draft {
  id: string;
  providerId: string;
  patientFirst: string;
  patientLast: string;
  patientDob: string | null;
  templateId: string | null;
  transcript: string;
  noteJson: NoteContent | null;
  updatedAt: string;
}

/** Full catalog row for the ICD-10 semantic search index. */
export interface IcdCode {
  code: string;
  description: string;
  category: string | null;
  embedding: number[] | null;
}

/** The minimal ICD reference persisted on a signed note version. */
export interface IcdCodeRef {
  code: string;
  description: string;
}

export type RedFlagSeverity = 'high' | 'moderate';

export interface RedFlag {
  severity: RedFlagSeverity;
  text: string;
}

/** The generated (and optionally edited) SOAP payload carried by drafts and version saves. */
export interface NoteContent {
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
  icdCodes: IcdCodeRef[];
  redFlags: RedFlag[];
}

/** Express request after `requireAuth` has attached the authenticated user. */
export interface AuthedRequest extends Request {
  user: SafeUser;
}

/**
 * Canonical API error codes (PRD §5). `NOT_IMPLEMENTED` covers Wave-1 route stubs;
 * `UNAUTHORIZED` covers a failed login attempt (distinct from an expired session so the
 * client can show a form error rather than the re-login modal).
 */
export type ErrorCode =
  | 'SESSION_EXPIRED'
  | 'ACCOUNT_DEACTIVATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION'
  | 'RATE_LIMITED'
  | 'INTERNAL'
  | 'UNAUTHORIZED'
  | 'NOT_IMPLEMENTED';

/** Standard error envelope returned by the API (PRD §5). */
export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
  };
}
