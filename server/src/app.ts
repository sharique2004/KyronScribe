// Express app assembly. Mounts the FULL route surface (PRD §5) up front so this file is
// frozen after Wave 1 — Wave-2 agents replace the stub router modules, never this file.
import express from 'express';
import cookieParser from 'cookie-parser';

import authRoutes from './routes/auth.js';
import healthRoutes from './routes/health.js';
import templatesRoutes from './routes/templates.js';
import patientsRoutes from './routes/patients.js';
import encountersRoutes from './routes/encounters.js';
import notesRoutes from './routes/notes.js';
import draftsRoutes from './routes/drafts.js';
import icdRoutes from './routes/icd.js';
import generateRoutes from './routes/generate.js';
import adminRoutes from './routes/admin.js';

import { notFound, errorHandler } from './middleware/errors.js';

export function createApp(): express.Express {
  const app = express();
  app.disable('x-powered-by');
  // Exactly one trusted proxy hop (nginx on the same box, infra/nginx). Makes req.ip
  // resolve from X-Forwarded-For so the login rate limiter buckets per client, not
  // per nginx (127.0.0.1). Harmless in local dev where no proxy sets the header.
  app.set('trust proxy', 1);

  app.use(cookieParser());
  app.use(express.json({ limit: '1mb' }));

  // Implemented in Wave 1 (A1):
  app.use('/api/auth', authRoutes);
  app.use('/api/health', healthRoutes);
  app.use('/api/templates', templatesRoutes);

  // Stubbed in Wave 1, replaced in Wave 2:
  app.use('/api/patients', patientsRoutes); // A4
  app.use('/api/encounters', encountersRoutes); // A4
  app.use('/api/notes', notesRoutes); // A4 (note-version helpers; see integration notes)
  app.use('/api/drafts', draftsRoutes); // A4
  app.use('/api/admin', adminRoutes); // A4
  app.use('/api/icd', icdRoutes); // A5
  app.use('/api/generate', generateRoutes); // A5

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
