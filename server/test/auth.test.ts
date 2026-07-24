// F1 — login happy path, bad credentials, deactivated account, session gate.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Express } from 'express';
import request from 'supertest';

import { closePool } from '../src/db.js';
import {
  buildApp,
  cleanupNamespace,
  createTestUser,
  loginAgent,
  TEST_PASSWORD,
} from './helpers.js';

const NS = 'a10test.auth.';
const PATIENT_LAST = 'A10authpatient';
const ACTIVE = `${NS}active@kyrontest.demo`;
const DEACTIVATED = `${NS}deactivated@kyrontest.demo`;

let app: Express;

beforeAll(async () => {
  app = await buildApp();
  await cleanupNamespace(NS, PATIENT_LAST);
  await createTestUser(ACTIVE, 'provider');
  await createTestUser(DEACTIVATED, 'provider', { isActive: false });
});

afterAll(async () => {
  await cleanupNamespace(NS, PATIENT_LAST);
  await closePool();
});

describe('POST /api/auth/login', () => {
  it('logs in with valid credentials, sets an httpOnly cookie, returns the user', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: ACTIVE, password: TEST_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(ACTIVE);
    expect(res.body.user.role).toBe('provider');
    expect(res.body.user).not.toHaveProperty('passwordHash');
    expect(res.body.user).not.toHaveProperty('password_hash');

    const setCookie = res.headers['set-cookie']?.[0] ?? '';
    expect(setCookie).toContain('kyron_session=');
    expect(setCookie.toLowerCase()).toContain('httponly');
  });

  it('rejects a wrong password with 401', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: ACTIVE, password: 'definitely-wrong' });
    expect(res.status).toBe(401);
  });

  it('rejects an unknown email with 401', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: `${NS}ghost@kyrontest.demo`, password: TEST_PASSWORD });
    expect(res.status).toBe(401);
  });

  it('rejects a deactivated account with 403 ACCOUNT_DEACTIVATED', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: DEACTIVATED, password: TEST_PASSWORD });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ACCOUNT_DEACTIVATED');
  });
});

describe('GET /api/auth/me', () => {
  it('returns the user for a live session', async () => {
    const agent = await loginAgent(app, ACTIVE);
    const res = await agent.get('/api/auth/me');
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(ACTIVE);
  });

  it('returns 401 SESSION_EXPIRED without a cookie', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('SESSION_EXPIRED');
  });

  it('trips 403 ACCOUNT_DEACTIVATED on the next request after deactivation (N3 tripwire)', async () => {
    const victim = `${NS}victim@kyrontest.demo`;
    await createTestUser(victim, 'provider');
    const agent = await loginAgent(app, victim);

    // Simulate the admin flipping is_active while the session cookie is still valid.
    const { query } = await import('../src/db.js');
    await query(`UPDATE users SET is_active = false, deactivated_at = now() WHERE email = $1`, [
      victim,
    ]);

    const res = await agent.get('/api/auth/me');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ACCOUNT_DEACTIVATED');
  });
});
