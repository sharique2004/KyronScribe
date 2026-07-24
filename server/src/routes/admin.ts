// Admin domain routes (PRD §5, §7.3). OWNED BY A4.
// Whole router is admin-gated. Never returns password_hash. Templates read fresh (no cache) so
// edits take effect on the provider's very next generation.
import { Router, type Request, type Response, type NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { query } from '../db.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { ApiError } from '../middleware/errors.js';
import { audit } from '../services/audit.js';
import { sendApproved } from '../services/email.js';
import type { ApprovalStatus, AuthedRequest, IcdCodeRef } from '../types.js';

const router = Router();

router.use(requireAuth, requireAdmin);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: string }).code === '23505'
  );
}

// ---- encounters ---------------------------------------------------------

const encountersQuerySchema = z.object({
  providerId: z.string().uuid().optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

interface AdminEncounterRow {
  id: string;
  created_at: Date;
  occurred_on: string;
  mrn: string;
  provider_id: string;
  provider_name: string;
  first_name: string;
  last_name: string;
  dob: string;
  template_name: string | null;
  version_count: number;
  lv_version_no: number | null;
  lv_icd_codes: IcdCodeRef[] | null;
}

// GET /api/admin/encounters?providerId=&from=&to= — dynamic filters; from/to inclusive.
router.get('/encounters', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { providerId, from, to } = encountersQuerySchema.parse(req.query);

    const clauses: string[] = [];
    const params: unknown[] = [];
    if (providerId) {
      params.push(providerId);
      clauses.push(`e.provider_id = $${params.length}`);
    }
    if (from) {
      params.push(from);
      clauses.push(`e.occurred_on >= $${params.length}::date`);
    }
    if (to) {
      params.push(to);
      clauses.push(`e.occurred_on <= $${params.length}::date`);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

    const { rows } = await query<AdminEncounterRow>(
      `SELECT e.id, e.created_at, to_char(e.occurred_on,'YYYY-MM-DD') AS occurred_on,
              u.id AS provider_id, u.full_name AS provider_name,
              p.mrn, p.first_name, p.last_name, to_char(p.dob,'YYYY-MM-DD') AS dob,
              t.name AS template_name,
              (SELECT count(*)::int FROM note_versions nv
                 JOIN notes n2 ON n2.id = nv.note_id
                WHERE n2.encounter_id = e.id) AS version_count,
              lv.version_no AS lv_version_no,
              lv.icd_codes  AS lv_icd_codes
       FROM encounters e
       JOIN users u ON u.id = e.provider_id
       JOIN patients p ON p.id = e.patient_id
       LEFT JOIN templates t ON t.id = e.template_id
       LEFT JOIN notes n ON n.encounter_id = e.id
       LEFT JOIN LATERAL (
         SELECT nv.version_no, nv.icd_codes
         FROM note_versions nv
         WHERE nv.note_id = n.id
         ORDER BY nv.version_no DESC
         LIMIT 1
       ) lv ON true
       ${where}
       ORDER BY e.occurred_on DESC, e.created_at DESC`,
      params,
    );

    const encounters = rows.map((r) => ({
      id: r.id,
      createdAt: r.created_at.toISOString(),
      occurredOn: r.occurred_on,
      provider: { id: r.provider_id, fullName: r.provider_name },
      patient: { mrn: r.mrn, firstName: r.first_name, lastName: r.last_name, dob: r.dob },
      templateName: r.template_name,
      versionCount: r.version_count,
      latestVersion:
        r.lv_version_no !== null
          ? { versionNo: r.lv_version_no, icdCodes: r.lv_icd_codes ?? [] }
          : null,
    }));

    res.json({ encounters });
  } catch (err) {
    next(err);
  }
});

// ---- providers ----------------------------------------------------------

interface ProviderRow {
  id: string;
  email: string;
  full_name: string;
  credentials: string | null;
  is_active: boolean;
  approval_status: ApprovalStatus;
  created_at: Date;
  deactivated_at: Date | null;
  encounter_count: number;
}

function toProvider(r: ProviderRow) {
  return {
    id: r.id,
    email: r.email,
    fullName: r.full_name,
    credentials: r.credentials,
    isActive: r.is_active,
    approvalStatus: r.approval_status,
    createdAt: r.created_at.toISOString(),
    deactivatedAt: r.deactivated_at ? r.deactivated_at.toISOString() : null,
    encounterCount: r.encounter_count,
  };
}

const PROVIDER_SELECT = `
  SELECT u.id, u.email, u.full_name, u.credentials, u.is_active, u.approval_status,
         u.created_at, u.deactivated_at,
         (SELECT count(*)::int FROM encounters e WHERE e.provider_id = u.id) AS encounter_count
  FROM users u`;

// GET /api/admin/providers — roster with encounter counts. Pending applicants surface
// first (they need action), then alphabetical.
router.get('/providers', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const { rows } = await query<ProviderRow>(
      `${PROVIDER_SELECT} WHERE u.role = 'provider'
       ORDER BY (u.approval_status = 'pending') DESC, u.full_name`,
    );
    res.json({ providers: rows.map(toProvider) });
  } catch (err) {
    next(err);
  }
});

const createProviderSchema = z.object({
  email: z.string().email().transform((e) => e.toLowerCase()),
  fullName: z.string().trim().min(1),
  credentials: z.string().trim().optional().default(''),
  password: z.string().min(8),
});

// POST /api/admin/providers — create a provider.
router.post('/providers', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const admin = (req as AuthedRequest).user;
    const body = createProviderSchema.parse(req.body);
    const passwordHash = await bcrypt.hash(body.password, 12);

    let inserted;
    try {
      inserted = await query<{ id: string }>(
        `INSERT INTO users (email, password_hash, full_name, credentials, role, is_active)
         VALUES ($1, $2, $3, $4, 'provider', true) RETURNING id`,
        [body.email, passwordHash, body.fullName, body.credentials || null],
      );
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ApiError(400, 'VALIDATION', 'email already exists');
      }
      throw err;
    }
    const id = inserted.rows[0]!.id;

    const { rows } = await query<ProviderRow>(`${PROVIDER_SELECT} WHERE u.id = $1`, [id]);
    audit(admin.id, 'provider.create', 'user', id, { email: body.email });
    res.status(201).json({ provider: toProvider(rows[0]!) });
  } catch (err) {
    next(err);
  }
});

// Either flip activation OR advance the approval lifecycle — never both in one call.
const patchProviderSchema = z.union([
  z.object({ isActive: z.boolean() }),
  z.object({ approvalStatus: z.enum(['approved', 'rejected']) }),
]);

// PATCH /api/admin/providers/:id — activate/deactivate, or approve/reject a pending
// applicant. Cannot target admins or self.
router.patch('/providers/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const admin = (req as AuthedRequest).user;
    const id = req.params.id ?? '';
    if (!UUID_RE.test(id)) throw new ApiError(404, 'NOT_FOUND', 'Provider not found');
    const body = patchProviderSchema.parse(req.body);

    if (id === admin.id) {
      throw new ApiError(403, 'FORBIDDEN', 'You cannot change your own account');
    }

    const target = await query<{ role: string; full_name: string; email: string }>(
      'SELECT role, full_name, email FROM users WHERE id = $1',
      [id],
    );
    const targetRow = target.rows[0];
    if (!targetRow) throw new ApiError(404, 'NOT_FOUND', 'Provider not found');
    if (targetRow.role === 'admin') {
      throw new ApiError(403, 'FORBIDDEN', 'Admin accounts cannot be modified');
    }

    if ('approvalStatus' in body) {
      // Approve ⇒ activate + clear deactivation; reject ⇒ deactivate. Both stamp the status.
      const approved = body.approvalStatus === 'approved';
      await query(
        `UPDATE users
         SET approval_status = $2,
             is_active = $3,
             deactivated_at = CASE WHEN $3 THEN NULL ELSE deactivated_at END
         WHERE id = $1`,
        [id, body.approvalStatus, approved],
      );
      audit(admin.id, approved ? 'provider.approve' : 'provider.reject', 'user', id, {});
      if (approved) {
        // Best-effort; never blocks or fails the response.
        void sendApproved(targetRow.email, targetRow.full_name);
      }
    } else {
      await query(
        `UPDATE users
         SET is_active = $2,
             deactivated_at = CASE WHEN $2 THEN NULL ELSE now() END
         WHERE id = $1`,
        [id, body.isActive],
      );
      audit(admin.id, body.isActive ? 'provider.reactivate' : 'provider.deactivate', 'user', id, {});
    }

    const { rows } = await query<ProviderRow>(`${PROVIDER_SELECT} WHERE u.id = $1`, [id]);
    res.json({ provider: toProvider(rows[0]!) });
  } catch (err) {
    next(err);
  }
});

// ---- templates ----------------------------------------------------------

interface TemplateRow {
  id: string;
  name: string;
  description: string | null;
  prompt: string;
  created_at: Date;
  updated_at: Date;
}

function toTemplate(r: TemplateRow) {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    prompt: r.prompt,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  };
}

const TEMPLATE_SELECT =
  'SELECT id, name, description, prompt, created_at, updated_at FROM templates';

const templateBodySchema = z.object({
  name: z.string().trim().min(1),
  description: z.string().trim().optional().default(''),
  prompt: z.string().min(1),
});

// GET /api/admin/templates — full (non-deleted) library.
router.get('/templates', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const { rows } = await query<TemplateRow>(
      `${TEMPLATE_SELECT} WHERE is_deleted = false ORDER BY name`,
    );
    res.json({ templates: rows.map(toTemplate) });
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/templates — create.
router.post('/templates', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const admin = (req as AuthedRequest).user;
    const body = templateBodySchema.parse(req.body);
    const { rows } = await query<TemplateRow>(
      `INSERT INTO templates (name, description, prompt, created_by)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, description, prompt, created_at, updated_at`,
      [body.name, body.description || null, body.prompt, admin.id],
    );
    const created = rows[0]!;
    audit(admin.id, 'template.create', 'template', created.id, { name: body.name });
    res.status(201).json({ template: toTemplate(created) });
  } catch (err) {
    next(err);
  }
});

// PUT /api/admin/templates/:id — update (bumps updated_at).
router.put('/templates/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const admin = (req as AuthedRequest).user;
    const id = req.params.id ?? '';
    if (!UUID_RE.test(id)) throw new ApiError(404, 'NOT_FOUND', 'Template not found');
    const body = templateBodySchema.parse(req.body);

    const { rows } = await query<TemplateRow>(
      `UPDATE templates
       SET name = $2, description = $3, prompt = $4, updated_at = now()
       WHERE id = $1 AND is_deleted = false
       RETURNING id, name, description, prompt, created_at, updated_at`,
      [id, body.name, body.description || null, body.prompt],
    );
    const updated = rows[0];
    if (!updated) throw new ApiError(404, 'NOT_FOUND', 'Template not found');
    audit(admin.id, 'template.update', 'template', id, { name: body.name });
    res.json({ template: toTemplate(updated) });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/admin/templates/:id — soft delete (encounters keep referencing it).
router.delete('/templates/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const admin = (req as AuthedRequest).user;
    const id = req.params.id ?? '';
    if (!UUID_RE.test(id)) throw new ApiError(404, 'NOT_FOUND', 'Template not found');

    const { rows } = await query<{ id: string }>(
      `UPDATE templates SET is_deleted = true, updated_at = now()
       WHERE id = $1 AND is_deleted = false RETURNING id`,
      [id],
    );
    if (!rows[0]) throw new ApiError(404, 'NOT_FOUND', 'Template not found');
    audit(admin.id, 'template.delete', 'template', id, {});
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
