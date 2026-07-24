// Note-version helper route (PRD §5). OWNED BY A4.
// The encounter routes already carry note data in their payloads; this thin router exposes
// version history keyed by note id (owner-or-admin) for completeness / direct linking.
import { Router, type Request, type Response, type NextFunction } from 'express';
import { query } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { ApiError } from '../middleware/errors.js';
import type { AuthedRequest, IcdCodeRef, RedFlag } from '../types.js';

const router = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface OwnerRow {
  provider_id: string;
}

interface VersionRow {
  id: string;
  version_no: number;
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
  icd_codes: IcdCodeRef[];
  red_flags: RedFlag[];
  created_at: Date;
  cb_id: string;
  cb_name: string;
}

// GET /api/notes/:noteId/versions — {versions:[NoteVersion]} newest first. Owner or admin only.
router.get(
  '/:noteId/versions',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = (req as AuthedRequest).user;
      const noteId = req.params.noteId ?? '';
      if (!UUID_RE.test(noteId)) throw new ApiError(404, 'NOT_FOUND', 'Note not found');

      const owner = await query<OwnerRow>(
        `SELECT e.provider_id
         FROM notes n
         JOIN encounters e ON e.id = n.encounter_id
         WHERE n.id = $1`,
        [noteId],
      );
      const row = owner.rows[0];
      if (!row) throw new ApiError(404, 'NOT_FOUND', 'Note not found');
      if (user.role !== 'admin' && row.provider_id !== user.id) {
        throw new ApiError(403, 'FORBIDDEN', 'You do not have access to this note');
      }

      const { rows } = await query<VersionRow>(
        `SELECT nv.id, nv.version_no, nv.subjective, nv.objective, nv.assessment, nv.plan,
                nv.icd_codes, nv.red_flags, nv.created_at,
                u.id AS cb_id, u.full_name AS cb_name
         FROM note_versions nv
         JOIN users u ON u.id = nv.created_by
         WHERE nv.note_id = $1
         ORDER BY nv.version_no DESC`,
        [noteId],
      );

      res.json({
        versions: rows.map((v) => ({
          id: v.id,
          versionNo: v.version_no,
          subjective: v.subjective,
          objective: v.objective,
          assessment: v.assessment,
          plan: v.plan,
          icdCodes: v.icd_codes ?? [],
          redFlags: v.red_flags ?? [],
          createdBy: { id: v.cb_id, fullName: v.cb_name },
          createdAt: v.created_at.toISOString(),
        })),
      });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
