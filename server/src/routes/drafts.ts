// Draft autosave (PRD §4, §5, F8). One in-flight encounter per provider; cross-device restore.
// OWNED BY A4.
import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { query } from '../db.js';
import { requireAuth, requireProvider } from '../middleware/auth.js';
import type { AuthedRequest, NoteContent } from '../types.js';

const router = Router();

const icdCodeSchema = z.object({ code: z.string(), description: z.string() });
const redFlagSchema = z.object({
  severity: z.enum(['high', 'moderate']),
  text: z.string(),
});
const noteContentSchema = z.object({
  subjective: z.string(),
  objective: z.string(),
  assessment: z.string(),
  plan: z.string(),
  icdCodes: z.array(icdCodeSchema),
  redFlags: z.array(redFlagSchema),
});

const putDraftSchema = z.object({
  patientFirst: z.string(),
  patientLast: z.string(),
  // YYYY-MM-DD like every other dob-accepting route; '' is tolerated (collapses to
  // null in the handler) so a cleared date field never 500s on the ::date cast.
  patientDob: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'patientDob must be YYYY-MM-DD')
    .or(z.literal(''))
    .optional()
    .nullable(),
  templateId: z.string().uuid().optional().nullable(),
  transcript: z.string(),
  noteJson: noteContentSchema.optional().nullable(),
});

interface DraftRow {
  patient_first: string;
  patient_last: string;
  patient_dob: string | null;
  template_id: string | null;
  transcript: string;
  note_json: NoteContent | null;
  updated_at: Date;
}

// GET /api/drafts/current — caller's draft or null.
router.get(
  '/current',
  requireAuth,
  requireProvider,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = (req as AuthedRequest).user;
      const { rows } = await query<DraftRow>(
        `SELECT patient_first, patient_last,
                to_char(patient_dob,'YYYY-MM-DD') AS patient_dob,
                template_id, transcript, note_json, updated_at
         FROM drafts WHERE provider_id = $1`,
        [user.id],
      );
      const row = rows[0];
      if (!row) {
        res.json({ draft: null });
        return;
      }
      res.json({
        draft: {
          patientFirst: row.patient_first,
          patientLast: row.patient_last,
          patientDob: row.patient_dob,
          templateId: row.template_id,
          transcript: row.transcript,
          noteJson: row.note_json,
          updatedAt: row.updated_at.toISOString(),
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

// PUT /api/drafts/current — upsert (autosave). Empty DOB string collapses to null.
router.put(
  '/current',
  requireAuth,
  requireProvider,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = (req as AuthedRequest).user;
      const body = putDraftSchema.parse(req.body);
      const dob = body.patientDob && body.patientDob.trim() !== '' ? body.patientDob : null;
      const templateId = body.templateId ?? null;
      const noteJson = body.noteJson ? JSON.stringify(body.noteJson) : null;

      const { rows } = await query<{ updated_at: Date }>(
        `INSERT INTO drafts
           (provider_id, patient_first, patient_last, patient_dob, template_id, transcript, note_json, updated_at)
         VALUES ($1, $2, $3, $4::date, $5, $6, $7::jsonb, now())
         ON CONFLICT (provider_id) DO UPDATE SET
           patient_first = EXCLUDED.patient_first,
           patient_last  = EXCLUDED.patient_last,
           patient_dob   = EXCLUDED.patient_dob,
           template_id   = EXCLUDED.template_id,
           transcript    = EXCLUDED.transcript,
           note_json     = EXCLUDED.note_json,
           updated_at    = now()
         RETURNING updated_at`,
        [user.id, body.patientFirst, body.patientLast, dob, templateId, body.transcript, noteJson],
      );

      res.json({ updatedAt: rows[0]!.updated_at.toISOString() });
    } catch (err) {
      next(err);
    }
  },
);

// DELETE /api/drafts/current — discard.
router.delete(
  '/current',
  requireAuth,
  requireProvider,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = (req as AuthedRequest).user;
      await query('DELETE FROM drafts WHERE provider_id = $1', [user.id]);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
