// POST /api/generate — SSE streaming clinical note generation (PRD §6, F3/F4/P1/P3/P5).
// Validation + template/patient lookups run BEFORE headers flush (so they can render the normal
// JSON error envelope). Once the stream opens we emit only SSE frames; any downstream failure
// becomes an `error` event, never a rewritten response. Mock mode is chosen when SCRIBE_MOCK is
// set or no API key is configured, and exercises the identical SSE path.
import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { getConfig, effectiveProvider, type AiProvider } from '../config.js';
import { query } from '../db.js';
import { requireAuth, requireProvider } from '../middleware/auth.js';
import { audit } from '../services/audit.js';
import type { AuthedRequest } from '../types.js';
import { runGeneration, type GenerationOpts, type ScribeEvent } from '../services/ai/scribe.js';
import { runGeminiGeneration } from '../services/ai/gemini.js';
import { runMockGeneration } from '../services/ai/mock.js';

const router = Router();

const bodySchema = z.object({
  patient: z.object({
    first: z.string().trim().min(1, 'first name is required'),
    last: z.string().trim().min(1, 'last name is required'),
    dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'dob must be YYYY-MM-DD'),
  }),
  transcript: z.string(),
  templateId: z.string().uuid().nullable().optional(),
});

router.post(
  '/',
  requireAuth,
  requireProvider,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const user = (req as AuthedRequest).user;

    // ── Pre-stream setup (errors here render the normal JSON envelope) ──
    let opts: GenerationOpts;
    let provider: AiProvider;
    let mock: boolean;
    let templateId: string | null;
    let patientId: string | null;
    try {
      const body = bodySchema.parse(req.body);
      const cfg = getConfig();
      templateId = body.templateId ?? null;

      // Load the template FRESH from the DB (non-deleted). Null → default base behaviour.
      let templatePrompt: string | null = null;
      let templateName: string | null = null;
      if (templateId) {
        const { rows } = await query<{ prompt: string; name: string }>(
          'SELECT prompt, name FROM templates WHERE id = $1 AND is_deleted = false',
          [templateId],
        );
        if (rows[0]) {
          templatePrompt = rows[0].prompt;
          templateName = rows[0].name;
        } else {
          templateId = null; // deleted/unknown → fall back to default behaviour
        }
      }

      // Patient lookup by identity triple → returning-vs-new is structural (F4).
      const { rows: pRows } = await query<{ id: string }>(
        'SELECT id FROM patients WHERE lower(first_name) = lower($1) AND lower(last_name) = lower($2) AND dob = $3',
        [body.patient.first, body.patient.last, body.patient.dob],
      );
      patientId = pRows[0]?.id ?? null;

      let isReturning = false;
      if (patientId) {
        const { rows: cRows } = await query<{ n: string }>(
          'SELECT count(*)::text AS n FROM encounters WHERE patient_id = $1',
          [patientId],
        );
        isReturning = Number(cRows[0]?.n ?? '0') > 0;
      }

      // Provider the request will actually use (SCRIBE_MOCK / missing keys degrade to mock).
      provider = effectiveProvider(cfg);
      mock = provider === 'mock';

      opts = {
        patient: body.patient,
        transcript: body.transcript,
        templatePrompt,
        templateName,
        isReturning,
        patientId,
        todayIso: new Date().toISOString().slice(0, 10),
        signal: new AbortController().signal, // replaced below with the request-tied controller
      };
    } catch (err) {
      next(err);
      return;
    }

    // ── Open the SSE stream ──
    const controller = new AbortController();
    opts = { ...opts, signal: controller.signal };

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();

    const emit = (event: ScribeEvent, data: Record<string, unknown>): void => {
      if (res.writableEnded) return;
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    // 15s heartbeat comments keep proxies from idling the connection.
    const heartbeat = setInterval(() => {
      if (!res.writableEnded) res.write(': hb\n\n');
    }, 15_000);

    let closed = false;
    req.on('close', () => {
      closed = true;
      controller.abort();
    });

    audit(user.id, 'generate', 'patient', patientId, { patientId, templateId, mock, provider });

    try {
      if (mock) {
        await runMockGeneration(opts, emit);
      } else if (provider === 'gemini') {
        await runGeminiGeneration(opts, emit);
      } else {
        await runGeneration(opts, emit);
      }
    } catch (err) {
      console.error('[generate] unexpected error', err);
      if (!closed && !res.writableEnded) {
        emit('error', { message: 'Generation failed' });
        emit('done', {});
      }
    } finally {
      clearInterval(heartbeat);
      if (!res.writableEnded) res.end();
    }
  },
);

export default router;
