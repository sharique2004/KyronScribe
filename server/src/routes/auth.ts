// Auth routes (PRD §5): login, logout, me.
import { Router, type Request, type Response, type NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { query } from '../db.js';
import { getConfig } from '../config.js';
import { ApiError } from '../middleware/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { audit } from '../services/audit.js';
import type { AuthedRequest, SafeUser, UserRole } from '../types.js';

const router = Router();

// 20 attempts / 15 min / IP (PRD §5). Renders the standard error envelope.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req: Request, res: Response) => {
    res
      .status(429)
      .json({ error: { code: 'RATE_LIMITED', message: 'Too many login attempts. Try again later.' } });
  },
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

interface LoginRow {
  id: string;
  email: string;
  password_hash: string;
  full_name: string;
  credentials: string | null;
  role: UserRole;
  is_active: boolean;
}

function safeUserFrom(row: LoginRow): SafeUser {
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    credentials: row.credentials,
    role: row.role,
    isActive: row.is_active,
  };
}

function issueSessionCookie(res: Response, user: SafeUser & { role: UserRole }): void {
  const cfg = getConfig();
  const token = jwt.sign({ sub: user.id, role: user.role }, cfg.jwtSecret, {
    algorithm: 'HS256',
    expiresIn: `${cfg.jwtTtlHours}h`,
  });
  res.cookie('kyron_session', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: cfg.nodeEnv === 'production',
    path: '/',
    maxAge: cfg.jwtTtlHours * 60 * 60 * 1000,
  });
}

router.post('/login', loginLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password } = loginSchema.parse(req.body);
    const normalizedEmail = email.toLowerCase();

    const { rows } = await query<LoginRow>(
      'SELECT id, email, password_hash, full_name, credentials, role, is_active FROM users WHERE email = $1',
      [normalizedEmail],
    );
    const row = rows[0];

    // Uniform failure for unknown-user and bad-password (no account enumeration).
    if (!row || !(await bcrypt.compare(password, row.password_hash))) {
      throw new ApiError(401, 'UNAUTHORIZED', 'Invalid email or password');
    }

    // Active check BEFORE issuing a token (PRD §5) so a deactivated user cannot log in.
    if (!row.is_active) {
      throw new ApiError(403, 'ACCOUNT_DEACTIVATED', 'Your account has been deactivated');
    }

    const user = safeUserFrom(row);
    issueSessionCookie(res, user);
    audit(user.id, 'login', 'user', user.id, { email: normalizedEmail });
    res.json({ user });
  } catch (err) {
    next(err);
  }
});

router.post('/logout', (_req: Request, res: Response) => {
  const cfg = getConfig();
  res.clearCookie('kyron_session', {
    httpOnly: true,
    sameSite: 'lax',
    secure: cfg.nodeEnv === 'production',
    path: '/',
  });
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req: Request, res: Response) => {
  res.json({ user: (req as AuthedRequest).user });
});

export default router;
