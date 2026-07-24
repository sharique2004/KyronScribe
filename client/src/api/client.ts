// Typed fetch wrapper over the /api surface (PRD §5, §7.4).
// - Always sends the httpOnly session cookie (`credentials: 'include'`).
// - Parses `{ error: { code, message } }` on failure and throws ApiError.
// - Emits auth lifecycle events on the shared bus so AuthContext can react
//   without every call site having to special-case 401/403.

import { bus } from './events';

const BASE = '/api';

/** Error codes the server returns (PRD §5). */
export type ApiErrorCode =
  | 'SESSION_EXPIRED'
  | 'ACCOUNT_DEACTIVATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION'
  | 'RATE_LIMITED'
  | 'INTERNAL'
  | 'NETWORK'
  | 'UNKNOWN';

export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;

  constructor(status: number, code: ApiErrorCode, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

interface WireError {
  error?: { code?: string; message?: string };
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(BASE + path, {
      method,
      credentials: 'include',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    // Network failure / offline — never an auth event, surface as-is.
    throw new ApiError(0, 'NETWORK', 'Network error. Check your connection and try again.');
  }

  if (res.ok) {
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  // Error path — try to read the structured body.
  let code: ApiErrorCode = 'UNKNOWN';
  let message = `Request failed (${res.status})`;
  try {
    const data = (await res.json()) as WireError;
    if (data.error?.code) code = data.error.code as ApiErrorCode;
    if (data.error?.message) message = data.error.message;
  } catch {
    /* non-JSON error body — keep defaults */
  }

  // Auth tripwires: broadcast so AuthContext can show the re-login modal (N2)
  // or the deactivation lockout (N3). Emitted before throwing so listeners are
  // primed by the time the caller's catch runs.
  if (res.status === 401 && code === 'SESSION_EXPIRED') {
    bus.emit('session-expired');
  } else if (res.status === 403 && code === 'ACCOUNT_DEACTIVATED') {
    bus.emit('account-deactivated');
  }

  throw new ApiError(res.status, code, message);
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  del: <T>(path: string, body?: unknown) => request<T>('DELETE', path, body),
};

export { bus };
