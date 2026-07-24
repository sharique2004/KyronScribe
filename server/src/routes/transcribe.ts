// POST /api/transcribe — voice dictation for the encounter transcript.
// The browser records audio (MediaRecorder) and posts the RAW bytes here; Gemini's
// multimodal input transcribes it server-side through the same provider-agnostic AI
// layer as generation. Deliberately not the browser SpeechRecognition API: that is
// disabled in several browsers (e.g. Brave) and ties dictation to Google's endpoint
// from the client. Mock mode returns canned dictation so the UX works keyless.
import express, { Router, type Request, type Response, type NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import { getConfig, effectiveProvider } from '../config.js';
import { requireAuth, requireProvider } from '../middleware/auth.js';
import { ApiError } from '../middleware/errors.js';
import { audit } from '../services/audit.js';
import type { AuthedRequest } from '../types.js';

const router = Router();

const ALLOWED_MIME = /^audio\/(webm|ogg|mp4|m4a|mpeg|wav|x-wav|aac|flac)(;.*)?$/i;

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many transcription requests — try again shortly.' } },
});

const TRANSCRIBE_INSTRUCTION =
  'Transcribe this clinical dictation verbatim as plain text. Use correct medical terminology and ' +
  'sentence punctuation. Do not summarize, annotate, or add any commentary — output only the ' +
  'transcribed speech. If the audio contains no intelligible speech, output an empty string.';

const MOCK_TEXT =
  '[Dictated] Patient reports symptoms as discussed during the visit. Vitals and examination ' +
  'findings as noted. Plan reviewed with the patient, follow-up arranged as appropriate.';

router.post(
  '/',
  requireAuth,
  requireProvider,
  limiter,
  express.raw({ type: ['audio/*'], limit: '15mb' }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = (req as AuthedRequest).user;
      const mime = (req.headers['content-type'] ?? '').split(';')[0]?.trim() ?? '';
      if (!ALLOWED_MIME.test(mime)) {
        throw new ApiError(400, 'VALIDATION', `Unsupported audio type "${mime || 'none'}".`);
      }
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        throw new ApiError(400, 'VALIDATION', 'No audio received.');
      }

      const cfg = getConfig();
      audit(user.id, 'transcribe', undefined, undefined, { bytes: req.body.length, mime });

      if (effectiveProvider(cfg) !== 'gemini') {
        // Mock/keyless path: canned dictation after a realistic beat.
        await new Promise((r) => setTimeout(r, 600));
        res.json({ text: MOCK_TEXT });
        return;
      }

      const ai = new GoogleGenAI({ apiKey: cfg.geminiApiKey });
      const result = await ai.models.generateContent({
        model: cfg.scribeModel,
        contents: [
          {
            role: 'user',
            parts: [
              { inlineData: { mimeType: mime, data: req.body.toString('base64') } },
              { text: TRANSCRIBE_INSTRUCTION },
            ],
          },
        ],
        config: /^gemini-3/.test(cfg.scribeModel)
          ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } }
          : {},
      });

      const text = (result.text ?? '').trim();
      res.json({ text });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
