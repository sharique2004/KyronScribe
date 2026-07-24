// F5 — append-only, monotonic note versioning; prior rows are never mutated.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Express } from 'express';

import { closePool, query } from '../src/db.js';
import { buildApp, cleanupNamespace, createTestUser, loginAgent, noteBody } from './helpers.js';

const NS = 'a10test.versions.';
const PATIENT_LAST = 'A10versionpatient';
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

describe('note versioning', () => {
  it('creates v1 on save, appends v2/v3 monotonically, and never touches prior rows', async () => {
    const agent = await loginAgent(app, PROVIDER);

    // v1 via encounter finalize
    const created = await agent.post('/api/encounters').send({
      patient: { first: 'Vera', last: PATIENT_LAST, dob: '1975-05-05' },
      templateId: null,
      transcript: 'Versioning test transcript.',
      note: noteBody('v1'),
    });
    expect(created.status).toBe(201);
    expect(created.body.versionNo).toBe(1);
    const encounterId: string = created.body.encounterId;
    const noteId: string = created.body.noteId;

    const countRows = async (): Promise<number> => {
      const { rows } = await query<{ n: string }>(
        `SELECT count(*) AS n FROM note_versions WHERE note_id = $1`,
        [noteId],
      );
      return Number(rows[0]!.n);
    };

    const v1Before = await query<{ id: string; subjective: string; plan: string }>(
      `SELECT id, subjective, plan FROM note_versions WHERE note_id = $1 AND version_no = 1`,
      [noteId],
    );
    expect(await countRows()).toBe(1);

    // v2 and v3 via append endpoint
    const v2 = await agent.post(`/api/encounters/${encounterId}/versions`).send(noteBody('v2'));
    expect(v2.status).toBe(201);
    expect(v2.body.versionNo).toBe(2);

    const v3 = await agent.post(`/api/encounters/${encounterId}/versions`).send(noteBody('v3'));
    expect(v3.status).toBe(201);
    expect(v3.body.versionNo).toBe(3);

    // Row count grew — nothing was overwritten
    expect(await countRows()).toBe(3);

    // v1 row is byte-identical after two appends (same id, same content)
    const v1After = await query<{ id: string; subjective: string; plan: string }>(
      `SELECT id, subjective, plan FROM note_versions WHERE note_id = $1 AND version_no = 1`,
      [noteId],
    );
    expect(v1After.rows[0]).toEqual(v1Before.rows[0]);
    expect(v1After.rows[0]!.subjective).toBe('Subjective v1');

    // API returns the full descending chain with author + timestamp
    const detail = await agent.get(`/api/encounters/${encounterId}`);
    expect(detail.status).toBe(200);
    const versions = detail.body.encounter.versions as Array<{
      versionNo: number;
      createdBy: { fullName: string };
      createdAt: string;
    }>;
    expect(versions.map((v) => v.versionNo)).toEqual([3, 2, 1]);
    for (const v of versions) {
      expect(v.createdAt).toBeTruthy();
      expect(v.createdBy.fullName).toBeTruthy();
    }
  });

  it('assigns distinct version numbers under concurrent appends (UNIQUE(note_id, version_no))', async () => {
    const agent = await loginAgent(app, PROVIDER);
    const created = await agent.post('/api/encounters').send({
      patient: { first: 'Race', last: PATIENT_LAST, dob: '1976-06-06' },
      templateId: null,
      transcript: 'Race-condition test transcript.',
      note: noteBody('race-v1'),
    });
    expect(created.status).toBe(201);
    const encounterId: string = created.body.encounterId;

    const results = await Promise.all([
      agent.post(`/api/encounters/${encounterId}/versions`).send(noteBody('race-a')),
      agent.post(`/api/encounters/${encounterId}/versions`).send(noteBody('race-b')),
    ]);
    const statuses = results.map((r) => r.status).sort();
    // Both must succeed (retry-on-conflict) — and with distinct version numbers.
    expect(statuses).toEqual([201, 201]);
    const nos = results.map((r) => r.body.versionNo).sort();
    expect(nos).toEqual([2, 3]);
  });
});
