// Patient lookup (PRD §5). Powers the workspace "returning patient" badge.
// OWNED BY A4.
import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { query } from '../db.js';
import { requireAuth, requireProvider } from '../middleware/auth.js';
import { ApiError } from '../middleware/errors.js';
import { listLessons } from '../services/lessons.js';

const router = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

      const { rows } = await query<LookupRow & { mrn: string }>(
        `SELECT p.id, p.mrn,
                count(e.id)::int      AS encounter_count,
                max(e.created_at)     AS last_seen
         FROM patients p
         LEFT JOIN encounters e ON e.patient_id = p.id
         WHERE lower(p.first_name) = lower($1)
           AND lower(p.last_name)  = lower($2)
           AND p.dob = $3::date
         GROUP BY p.id, p.mrn`,
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
        mrn: row.mrn,
        encounterCount: row.encounter_count,
        ...(row.last_seen ? { lastSeen: row.last_seen.toISOString() } : {}),
      });
    } catch (err) {
      next(err);
    }
  },
);

const searchSchema = z.object({ q: z.string().trim().min(2) });

interface SearchRow {
  id: string;
  mrn: string;
  first_name: string;
  last_name: string;
  dob: string;
  encounter_count: number;
  last_seen: Date | null;
  sim: number;
}

// GET /api/patients/search?q= — fuzzy patient autocomplete for the workspace.
// Case-insensitive substring + trigram similarity over the full name, plus MRN prefix
// match, so "marg che", "MARGARET", or "9A66" all find the same entity. The provider
// then explicitly links the note to the selected patient id.
router.get(
  '/search',
  requireAuth,
  requireProvider,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { q } = searchSchema.parse(req.query);
      const { rows } = await query<SearchRow>(
        `SELECT p.id, p.mrn, p.first_name, p.last_name, to_char(p.dob,'YYYY-MM-DD') AS dob,
                (SELECT count(*)::int FROM encounters e WHERE e.patient_id = p.id) AS encounter_count,
                (SELECT max(e.occurred_on) FROM encounters e WHERE e.patient_id = p.id) AS last_seen,
                similarity(p.first_name || ' ' || p.last_name, $1) AS sim
         FROM patients p
         WHERE (p.first_name || ' ' || p.last_name) ILIKE '%' || $1 || '%'
            OR p.mrn ILIKE $1 || '%'
            OR similarity(p.first_name || ' ' || p.last_name, $1) > 0.3
         ORDER BY sim DESC, p.last_name, p.first_name
         LIMIT 8`,
        [q],
      );
      res.json({
        patients: rows.map((r) => ({
          id: r.id,
          mrn: r.mrn,
          firstName: r.first_name,
          lastName: r.last_name,
          dob: r.dob,
          encounterCount: r.encounter_count,
          ...(r.last_seen ? { lastSeen: new Date(r.last_seen).toISOString().slice(0, 10) } : {}),
        })),
      });
    } catch (err) {
      next(err);
    }
  },
);

// GET /api/patients/:patientId/lessons — the patient's diagnostic-revision lessons
// (self-improving loop). Like history, lessons are patient-level clinical record:
// readable by any authenticated provider or admin.
router.get(
  '/:patientId/lessons',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const patientId = req.params.patientId ?? '';
      if (!UUID_RE.test(patientId)) throw new ApiError(404, 'NOT_FOUND', 'Patient not found.');
      const lessons = await listLessons(patientId);
      res.json({ lessons });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
