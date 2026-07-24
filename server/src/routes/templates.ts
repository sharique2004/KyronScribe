// GET /api/templates — provider-facing template selector (PRD §5).
// Owned by A1 (core-adjacent): admin CRUD lives in the admin router; this is the read path
// the workspace uses. No cache — reads are cheap and admin edits must be visible immediately.
import { Router, type Request, type Response, type NextFunction } from 'express';
import { query } from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

interface TemplateRow {
  id: string;
  name: string;
  description: string | null;
}

router.get('/', requireAuth, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const { rows } = await query<TemplateRow>(
      'SELECT id, name, description FROM templates WHERE is_deleted = false ORDER BY name',
    );
    res.json({ templates: rows });
  } catch (err) {
    next(err);
  }
});

export default router;
