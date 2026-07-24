// Patient lookup (PRD §5). Powers the workspace "returning patient" badge.
// OWNED BY A4.
import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { query } from '../db.js';
import { requireAuth, requireProvider } from '../middleware/auth.js';

const router = Router();

const lookupSchema = z.object({
  first: z.string().trim().min(1),
  last: z.string().trim().min(1),
  dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'dob must be YYYY-MM-DD'),
});

interface LookupRow {
  id: string;
  encounter_count: number;
  last_seen: Date | null;
}

// GET /api/patients/lookup?first=&last=&dob=
// Identity match is case-insensitive on names. encounterCount + lastSeen are computed across
// ALL providers — the clinical record is shared; only note *viewing* is provider-scoped.
router.get(
  '/lookup',
  requireAuth,
  requireProvider,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { first, last, dob } = lookupSchema.parse(req.query);

      const { rows } = await query<LookupRow>(
        `SELECT p.id,
                count(e.id)::int      AS encounter_count,
                max(e.created_at)     AS last_seen
         FROM patients p
         LEFT JOIN encounters e ON e.patient_id = p.id
         WHERE lower(p.first_name) = lower($1)
           AND lower(p.last_name)  = lower($2)
           AND p.dob = $3::date
         GROUP BY p.id`,
        [first, last, dob],
      );

      const row = rows[0];
      if (!row) {
        res.json({ exists: false, encounterCount: 0 });
        return;
      }

      res.json({
        exists: true,
        patientId: row.id,
        encounterCount: row.encounter_count,
        ...(row.last_seen ? { lastSeen: row.last_seen.toISOString() } : {}),
      });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
