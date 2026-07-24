// GET /api/icd/search?q= — semantic ICD-10 search (PRD §5, §6.5, F6).
// Any authenticated user. Queries under 2 chars return an empty result set (no thrash). The
// heavy lifting (MiniLM cosine + ILIKE fallback) lives in the embeddings service.
import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { searchIcd } from '../services/embeddings.js';

const router = Router();

const querySchema = z.object({ q: z.string().optional() });

router.get('/search', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { q } = querySchema.parse(req.query);
    const term = (q ?? '').trim();
    if (term.length < 2) {
      res.json({ results: [] });
      return;
    }
    const results = await searchIcd(term, 8);
    res.json({ results });
  } catch (err) {
    next(err);
  }
});

export default router;
