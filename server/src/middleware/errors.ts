// Error plumbing: a typed ApiError, a 404 handler, and the terminal error handler
// that renders the PRD §5 envelope `{ error: { code, message } }`.
import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import type { ErrorCode } from '../types.js';

export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  constructor(status: number, code: ErrorCode, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

/** Terminal 404 for unmatched routes. */
export function notFound(_req: Request, res: Response): void {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Resource not found' } });
}

/** Terminal error handler. Must be mounted last, with all four args so Express treats it as such. */
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  // If a stream (e.g. SSE) already flushed headers, we cannot rewrite the response.
  if (res.headersSent) {
    next(err);
    return;
  }

  if (err instanceof ApiError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message } });
    return;
  }

  if (err instanceof ZodError) {
    const message =
      err.issues
        .map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`)
        .join('; ') || 'Validation failed';
    res.status(400).json({ error: { code: 'VALIDATION', message } });
    return;
  }

  console.error('[error]', err);
  res.status(500).json({ error: { code: 'INTERNAL', message: 'Internal server error' } });
}
