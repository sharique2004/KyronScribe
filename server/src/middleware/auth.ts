// Auth middleware chain (PRD §5): cookie → verify JWT (HS256) → per-request active check.
// The DB lookup on every protected request is a deliberate trade (one indexed PK read) so an
// admin deactivation takes effect instantly — scenario N3.
import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { getConfig } from '../config.js';
import { query } from '../db.js';
import { ApiError } from './errors.js';
import type { AuthedRequest, SafeUser, UserRole } from '../types.js';

interface SessionClaims {
  sub: string;
  role: UserRole;
}

interface UserRow {
  id: string;
  email: string;
  full_name: string;
  credentials: string | null;
  role: UserRole;
  is_active: boolean;
}

function toSafeUser(row: UserRow): SafeUser {
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    credentials: row.credentials,
    role: row.role,
    isActive: row.is_active,
  };
}

/** Verify the session cookie and attach `req.user`. 401 on missing/invalid/expired; 403 if deactivated. */
export async function requireAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const token = (req.cookies as Record<string, string> | undefined)?.kyron_session;
    if (!token) throw new ApiError(401, 'SESSION_EXPIRED', 'Not authenticated');

    let claims: SessionClaims;
    try {
      claims = jwt.verify(token, getConfig().jwtSecret, {
        algorithms: ['HS256'],
      }) as SessionClaims;
    } catch {
      throw new ApiError(401, 'SESSION_EXPIRED', 'Session expired');
    }

    const { rows } = await query<UserRow>(
      'SELECT id, email, full_name, credentials, role, is_active FROM users WHERE id = $1',
      [claims.sub],
    );
    const row = rows[0];
    if (!row) throw new ApiError(401, 'SESSION_EXPIRED', 'Session expired');
    if (!row.is_active) {
      throw new ApiError(403, 'ACCOUNT_DEACTIVATED', 'Your account has been deactivated');
    }

    (req as AuthedRequest).user = toSafeUser(row);
    next();
  } catch (err) {
    next(err);
  }
}

/** Require an authenticated admin. Layer after `requireAuth`. */
export function requireAdmin(req: Request, _res: Response, next: NextFunction): void {
  const user = (req as AuthedRequest).user;
  if (!user) {
    next(new ApiError(401, 'SESSION_EXPIRED', 'Not authenticated'));
    return;
  }
  if (user.role !== 'admin') {
    next(new ApiError(403, 'FORBIDDEN', 'Admin access required'));
    return;
  }
  next();
}

/** Require an authenticated provider. Layer after `requireAuth`. */
export function requireProvider(req: Request, _res: Response, next: NextFunction): void {
  const user = (req as AuthedRequest).user;
  if (!user) {
    next(new ApiError(401, 'SESSION_EXPIRED', 'Not authenticated'));
    return;
  }
  if (user.role !== 'provider') {
    next(new ApiError(403, 'FORBIDDEN', 'Provider access required'));
    return;
  }
  next();
}
