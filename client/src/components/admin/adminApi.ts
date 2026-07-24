// OWNED BY A8 — a PATCH helper mirroring '@/api/client' semantics.
// The frozen api client (A3) exposes get/post/put/del only, but the admin
// provider-status endpoint is PATCH /api/admin/providers/:id per the wire
// contract. This helper sends PATCH with the same cookie + auth-event-bus
// behavior so 401/403 tripwires still drive the re-login modal / lockout.
import { ApiError, bus } from '@/api/client';
import type { ApiErrorCode } from '@/api/client';

interface WireError {
  error?: { code?: string; message?: string };
}

export async function apiPatch<T>(path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Network error. Check your connection and try again.');
  }

  if (res.ok) {
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  let code: ApiErrorCode = 'UNKNOWN';
  let message = `Request failed (${res.status})`;
  try {
    const data = (await res.json()) as WireError;
    if (data.error?.code) code = data.error.code as ApiErrorCode;
    if (data.error?.message) message = data.error.message;
  } catch {
    /* non-JSON error body — keep defaults */
  }

  if (res.status === 401 && code === 'SESSION_EXPIRED') {
    bus.emit('session-expired');
  } else if (res.status === 403 && code === 'ACCOUNT_DEACTIVATED') {
    bus.emit('account-deactivated');
  }

  throw new ApiError(res.status, code, message);
}
