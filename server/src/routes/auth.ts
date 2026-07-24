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
import { sendSignupReceived } from '../services/email.js';
import type { ApprovalStatus, AuthedRequest, SafeUser, UserRole } from '../types.js';

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

// Self-signup is cheaper to abuse than login (it writes a row), so it is gated tighter:
// 10 applications / 15 min / IP.
const signupLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req: Request, res: Response) => {
    res
      .status(429)
      .json({ error: { code: 'RATE_LIMITED', message: 'Too many signup attempts. Try again later.' } });
  },
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const signupSchema = z.object({
  fullName: z.string().trim().min(1),
  credentials: z.string().trim().optional().default(''),
  email: z.string().email().transform((e) => e.toLowerCase()),
  password: z.string().min(8),
});

interface LoginRow {
  id: string;
  email: string;
  password_hash: string;
  full_name: string;
  credentials: string | null;
  role: UserRole;
  is_active: boolean;
  approval_status: ApprovalStatus;
  onboarded_at: Date | null;
}

function safeUserFrom(row: LoginRow): SafeUser {
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    credentials: row.credentials,
    role: row.role,
    isActive: row.is_active,
    onboarded: row.onboarded_at !== null,
  };
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505'
  );
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

// POST /api/auth/signup — self-service applicant registration. Lands as a 'pending'
// provider (is_active FALSE) awaiting admin approval. Never issues a session.
router.post('/signup', signupLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { fullName, credentials, email, password } = signupSchema.parse(req.body);
    const passwordHash = await bcrypt.hash(password, 12);

    let inserted;
    try {
      inserted = await query<{ id: string }>(
        `INSERT INTO users (email, password_hash, full_name, credentials, role, is_active, approval_status)
         VALUES ($1, $2, $3, $4, 'provider', false, 'pending') RETURNING id`,
        [email, passwordHash, fullName, credentials || null],
      );
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ApiError(400, 'VALIDATION', 'An account with this email already exists');
      }
      throw err;
    }
    const id = inserted.rows[0]!.id;

    audit(id, 'provider.signup', 'user', id, { email });
    // Best-effort; never blocks or fails the response.
    void sendSignupReceived(email, fullName);

    res.status(201).json({ status: 'pending' });
  } catch (err) {
    next(err);
  }
});

router.post('/login', loginLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password } = loginSchema.parse(req.body);
    const normalizedEmail = email.toLowerCase();

    const { rows } = await query<LoginRow>(
      `SELECT id, email, password_hash, full_name, credentials, role, is_active,
              approval_status, onboarded_at
       FROM users WHERE email = $1`,
      [normalizedEmail],
    );
    const row = rows[0];

    // Verify the password FIRST — the lifecycle branches below only run for a caller who
    // proved they own the account, so nothing here leaks account state to a stranger.
    // Uniform failure for unknown-user and bad-password (no account enumeration).
    if (!row || !(await bcrypt.compare(password, row.password_hash))) {
      throw new ApiError(401, 'UNAUTHORIZED', 'Invalid email or password');
    }

    // Pending applicant: awaiting review — distinct code so the client can explain the wait.
    if (row.approval_status === 'pending') {
      throw new ApiError(403, 'PENDING_APPROVAL', 'Your application is awaiting administrator review.');
    }

    // Rejected applicant: no leak — generic failure, identical to a bad password.
    if (row.approval_status === 'rejected') {
      throw new ApiError(401, 'UNAUTHORIZED', 'Invalid email or password');
    }

    // Approved but deactivated by an admin.
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

// POST /api/auth/onboarding-complete — stamp onboarded_at (idempotent: keeps the first stamp).
router.post(
  '/onboarding-complete',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = (req as AuthedRequest).user;
      await query(
        `UPDATE users SET onboarded_at = COALESCE(onboarded_at, now()) WHERE id = $1`,
        [user.id],
      );
      audit(user.id, 'onboarding.complete', 'user', user.id, {});
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/auth/onboarding-reset — clear onboarded_at so the guided tour replays.
router.post(
  '/onboarding-reset',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = (req as AuthedRequest).user;
      await query(`UPDATE users SET onboarded_at = NULL WHERE id = $1`, [user.id]);
      audit(user.id, 'onboarding.reset', 'user', user.id, {});
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
