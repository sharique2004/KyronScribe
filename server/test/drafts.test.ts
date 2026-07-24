// F8 — server-side draft autosave: upsert roundtrip, per-provider singleton, discard.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Express } from 'express';

import { closePool, query } from '../src/db.js';
import { buildApp, cleanupNamespace, createTestUser, loginAgent } from './helpers.js';

const NS = 'a10test.drafts.';
const PATIENT_LAST = 'A10draftpatient';
const PROVIDER = `${NS}provider@kyrontest.demo`;

let app: Express;

beforeAll(async () => {
  app = await buildApp();
  await cleanupNamespace(NS, PATIENT_LAST);
  await createTestUser(PROVIDER, 'provider');
});

afterAll(async () => {
  await cleanupNamespace(NS, PATIENT_LAST);
  await closePool();
});

describe('draft autosave', () => {
  it('starts with no draft', async () => {
    const agent = await loginAgent(app, PROVIDER);
    const res = await agent.get('/api/drafts/current');
    expect(res.status).toBe(200);
    expect(res.body.draft).toBeNull();
  });

  it('upserts and reads back the full draft state, including a generated note', async () => {
    const agent = await loginAgent(app, PROVIDER);
    const noteJson = {
      subjective: 'Draft subjective',
      objective: 'Not documented during this encounter.',
      assessment: 'Draft assessment',
      plan: 'Draft plan',
      icdCodes: [{ code: 'E11.9', description: 'Type 2 diabetes mellitus without complications' }],
      redFlags: [{ severity: 'high' as const, text: 'Test flag' }],
    };

    const put = await agent.put('/api/drafts/current').send({
      patientFirst: 'Dora',
      patientLast: PATIENT_LAST,
      patientDob: '1990-09-09',
      templateId: null,
      transcript: 'Draft transcript body',
      noteJson,
    });
    expect(put.status).toBe(200);
    expect(put.body.updatedAt).toBeTruthy();

    const got = await agent.get('/api/drafts/current');
    expect(got.status).toBe(200);
    expect(got.body.draft.patientFirst).toBe('Dora');
    expect(got.body.draft.patientDob).toBe('1990-09-09');
    expect(got.body.draft.transcript).toBe('Draft transcript body');
    expect(got.body.draft.noteJson).toEqual(noteJson);
  });

  it('a second PUT replaces the draft in place — one row per provider', async () => {
    const agent = await loginAgent(app, PROVIDER);
    const put = await agent.put('/api/drafts/current').send({
      patientFirst: 'Dora2',
      patientLast: PATIENT_LAST,
      patientDob: null,
      templateId: null,
      transcript: 'Updated transcript',
      noteJson: null,
    });
    expect(put.status).toBe(200);

    const got = await agent.get('/api/drafts/current');
    expect(got.body.draft.patientFirst).toBe('Dora2');
    expect(got.body.draft.transcript).toBe('Updated transcript');
    expect(got.body.draft.noteJson).toBeNull();

    const { rows } = await query<{ n: string }>(
      `SELECT count(*) AS n FROM drafts d JOIN users u ON u.id = d.provider_id WHERE u.email = $1`,
      [PROVIDER],
    );
    expect(Number(rows[0]!.n)).toBe(1);
  });

  it('DELETE discards the draft', async () => {
    const agent = await loginAgent(app, PROVIDER);
    const del = await agent.delete('/api/drafts/current');
    expect(del.status).toBe(200);

    const got = await agent.get('/api/drafts/current');
    expect(got.body.draft).toBeNull();
  });
});
