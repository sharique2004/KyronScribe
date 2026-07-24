// B1 — self-service signup, approval lifecycle, onboarding tour state.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Express } from 'express';
import request from 'supertest';

import { closePool, query } from '../src/db.js';
import { buildApp, cleanupNamespace, createTestUser, loginAgent, TEST_PASSWORD } from './helpers.js';

const NS = 'b1test.signup.';
const PATIENT_LAST = 'B1signuppatient';
const ADMIN = `${NS}admin@kyrontest.demo`;

const APPLICANT = `${NS}applicant@kyrontest.demo`;
const REJECTED = `${NS}rejected@kyrontest.demo`;

let app: Express;

/** Look up a user's id by email (namespaced test data only). */
async function idOf(email: string): Promise<string> {
  const { rows } = await query<{ id: string }>('SELECT id FROM users WHERE email = $1', [
    email.toLowerCase(),
  ]);
  if (!rows[0]) throw new Error(`no user ${email}`);
  return rows[0].id;
}

beforeAll(async () => {
  app = await buildApp();
  await cleanupNamespace(NS, PATIENT_LAST);
  await createTestUser(ADMIN, 'admin');
});

afterAll(async () => {
  await cleanupNamespace(NS, PATIENT_LAST);
  await closePool();
});

describe('POST /api/auth/signup', () => {
  it('validates: short password is rejected with 400', async () => {
    const res = await request(app)
      .post('/api/auth/signup')
      .send({ fullName: 'Dr. Short', email: `${NS}short@kyrontest.demo`, password: 'sh0rt' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION');
  });

  it('creates a pending applicant (201 {status:pending}) that cannot yet log in', async () => {
    const res = await request(app)
      .post('/api/auth/signup')
      .send({
        fullName: 'Dr. Applicant',
        credentials: 'MD',
        email: APPLICANT,
        password: TEST_PASSWORD,
      });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ status: 'pending' });

    // Correct password, but pending review → 403 PENDING_APPROVAL.
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: APPLICANT, password: TEST_PASSWORD });
    expect(login.status).toBe(403);
    expect(login.body.error.code).toBe('PENDING_APPROVAL');
  });

  it('rejects a duplicate email with 400', async () => {
    const res = await request(app)
      .post('/api/auth/signup')
      .send({ fullName: 'Dr. Dup', email: APPLICANT, password: TEST_PASSWORD });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION');
    expect(res.body.error.message).toMatch(/already exists/i);
  });
});

describe('approval lifecycle + onboarding', () => {
  it('admin approve → login succeeds → onboarding round-trips', async () => {
    const adminAgent = await loginAgent(app, ADMIN);
    const applicantId = await idOf(APPLICANT);

    // Pending applicant surfaces in the roster with approvalStatus.
    const list = await adminAgent.get('/api/admin/providers');
    expect(list.status).toBe(200);
    const found = list.body.providers.find((p: { id: string }) => p.id === applicantId);
    expect(found.approvalStatus).toBe('pending');

    const approve = await adminAgent
      .patch(`/api/admin/providers/${applicantId}`)
      .send({ approvalStatus: 'approved' });
    expect(approve.status).toBe(200);
    expect(approve.body.provider.approvalStatus).toBe('approved');
    expect(approve.body.provider.isActive).toBe(true);

    // Now the applicant can log in.
    const agent = await loginAgent(app, APPLICANT);
    const me1 = await agent.get('/api/auth/me');
    expect(me1.status).toBe(200);
    expect(me1.body.user.onboarded).toBe(false);

    const complete = await agent.post('/api/auth/onboarding-complete');
    expect(complete.status).toBe(200);
    expect(complete.body).toEqual({ ok: true });

    const me2 = await agent.get('/api/auth/me');
    expect(me2.body.user.onboarded).toBe(true);

    const reset = await agent.post('/api/auth/onboarding-reset');
    expect(reset.status).toBe(200);
    expect(reset.body).toEqual({ ok: true });

    const me3 = await agent.get('/api/auth/me');
    expect(me3.body.user.onboarded).toBe(false);
  });

  it('admin reject → login returns a generic 401 (no state leak)', async () => {
    await request(app)
      .post('/api/auth/signup')
      .send({ fullName: 'Dr. Rejected', email: REJECTED, password: TEST_PASSWORD });

    const adminAgent = await loginAgent(app, ADMIN);
    const rejectedId = await idOf(REJECTED);
    const reject = await adminAgent
      .patch(`/api/admin/providers/${rejectedId}`)
      .send({ approvalStatus: 'rejected' });
    expect(reject.status).toBe(200);
    expect(reject.body.provider.approvalStatus).toBe('rejected');
    expect(reject.body.provider.isActive).toBe(false);

    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: REJECTED, password: TEST_PASSWORD });
    expect(login.status).toBe(401);
    expect(login.body.error.code).toBe('UNAUTHORIZED');
  });
});
