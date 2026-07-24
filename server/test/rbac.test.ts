// F1 — provider isolation and admin gating across the encounter + admin surface.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Express } from 'express';
import request from 'supertest';

import { closePool } from '../src/db.js';
import { buildApp, cleanupNamespace, createTestUser, loginAgent, noteBody } from './helpers.js';

const NS = 'a10test.rbac.';
const PATIENT_LAST = 'A10rbacpatient';
const OWNER = `${NS}owner@kyrontest.demo`;
const INTRUDER = `${NS}intruder@kyrontest.demo`;
const ADMIN = `${NS}admin@kyrontest.demo`;

let app: Express;
let encounterId: string;

beforeAll(async () => {
  app = await buildApp();
  await cleanupNamespace(NS, PATIENT_LAST);
  await createTestUser(OWNER, 'provider');
  await createTestUser(INTRUDER, 'provider');
  await createTestUser(ADMIN, 'admin');

  const owner = await loginAgent(app, OWNER);
  const res = await owner.post('/api/encounters').send({
    patient: { first: 'Rbac', last: PATIENT_LAST, dob: '1980-01-01' },
    templateId: null,
    transcript: 'RBAC test transcript with enough clinical text.',
    note: noteBody('rbac-v1'),
  });
  expect(res.status).toBe(201);
  encounterId = res.body.encounterId;
});

afterAll(async () => {
  await cleanupNamespace(NS, PATIENT_LAST);
  await closePool();
});

describe('provider isolation', () => {
  it('owner can read their own encounter', async () => {
    const owner = await loginAgent(app, OWNER);
    const res = await owner.get(`/api/encounters/${encounterId}`);
    expect(res.status).toBe(200);
    expect(res.body.encounter.patient.lastName).toBe(PATIENT_LAST);
  });

  it("another provider gets 403 FORBIDDEN on someone else's encounter", async () => {
    const intruder = await loginAgent(app, INTRUDER);
    const res = await intruder.get(`/api/encounters/${encounterId}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it("another provider cannot append a version to someone else's note", async () => {
    const intruder = await loginAgent(app, INTRUDER);
    const res = await intruder
      .post(`/api/encounters/${encounterId}/versions`)
      .send(noteBody('rbac-intrusion'));
    expect(res.status).toBe(403);
  });

  it("the owner's encounter list never contains other providers' encounters", async () => {
    const intruder = await loginAgent(app, INTRUDER);
    const res = await intruder.get('/api/encounters');
    expect(res.status).toBe(200);
    const ids = res.body.encounters.map((e: { id: string }) => e.id);
    expect(ids).not.toContain(encounterId);
  });

  it('an unknown encounter id is a 404, not an information leak', async () => {
    const owner = await loginAgent(app, OWNER);
    const res = await owner.get('/api/encounters/00000000-0000-0000-0000-000000000000');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

describe('admin gating', () => {
  it('admin can read any encounter', async () => {
    const admin = await loginAgent(app, ADMIN);
    const res = await admin.get(`/api/encounters/${encounterId}`);
    expect(res.status).toBe(200);
  });

  it('admin sees the encounter in the practice-wide list', async () => {
    const admin = await loginAgent(app, ADMIN);
    const res = await admin.get('/api/admin/encounters');
    expect(res.status).toBe(200);
    const ids = res.body.encounters.map((e: { id: string }) => e.id);
    expect(ids).toContain(encounterId);
  });

  it('a provider is rejected from admin routes with 403', async () => {
    const owner = await loginAgent(app, OWNER);
    for (const path of ['/api/admin/encounters', '/api/admin/providers', '/api/admin/templates']) {
      const res = await owner.get(path);
      expect(res.status, path).toBe(403);
    }
  });

  it('an admin is rejected from provider-only routes with 403', async () => {
    const admin = await loginAgent(app, ADMIN);
    const res = await admin.get('/api/drafts/current');
    expect(res.status).toBe(403);
  });

  it('everything is 401 without a session', async () => {
    for (const path of [`/api/encounters/${encounterId}`, '/api/admin/encounters', '/api/drafts/current']) {
      const res = await request(app).get(path);
      expect(res.status, path).toBe(401);
    }
  });
});
