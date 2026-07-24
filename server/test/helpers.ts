// Shared test utilities (A10). Integration tests run against the real local DB with a
// throwaway namespace (distinct emails/patient names per file) that is created in
// beforeAll and fully removed in afterAll — the seeded demo data is never touched.
import bcrypt from 'bcryptjs';
import type { Express } from 'express';
import request from 'supertest';

import { loadConfig } from '../src/config.js';
import { createApp } from '../src/app.js';
import { query } from '../src/db.js';

export const TEST_PASSWORD = 'A10TestPass2026!';

// bcrypt cost 4 in tests: this is throwaway data and cost 12 adds ~1s per user for
// zero test value. The app itself always hashes at cost 12 (see routes/admin.ts).
const TEST_HASH_ROUNDS = 4;

export interface TestUser {
  id: string;
  email: string;
  role: 'provider' | 'admin';
}

/** loadConfig() must run before createApp()/getPool(); idempotent across files. */
export async function buildApp(): Promise<Express> {
  await loadConfig();
  return createApp();
}

/** Insert a namespaced user directly (upsert — safe if a previous run crashed). */
export async function createTestUser(
  email: string,
  role: 'provider' | 'admin',
  opts: { isActive?: boolean } = {},
): Promise<TestUser> {
  const hash = await bcrypt.hash(TEST_PASSWORD, TEST_HASH_ROUNDS);
  const { rows } = await query<{ id: string }>(
    `INSERT INTO users (email, password_hash, full_name, credentials, role, is_active)
     VALUES ($1, $2, $3, 'MD', $4, $5)
     ON CONFLICT (email) DO UPDATE
       SET password_hash = EXCLUDED.password_hash,
           is_active = EXCLUDED.is_active,
           deactivated_at = NULL
     RETURNING id`,
    [email.toLowerCase(), hash, `Test ${email.split('@')[0]}`, role, opts.isActive ?? true],
  );
  return { id: rows[0]!.id, email: email.toLowerCase(), role };
}

/** supertest agent with a live kyron_session cookie for the given user. */
export async function loginAgent(
  app: Express,
  email: string,
): Promise<request.Agent> {
  const agent = request.agent(app);
  const res = await agent
    .post('/api/auth/login')
    .send({ email, password: TEST_PASSWORD });
  if (res.status !== 200) {
    throw new Error(`test login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return agent;
}

/**
 * Remove every row the namespace created, in FK-safe order.
 * `emailPrefix` scopes users; `patientLast` scopes patients/encounters.
 */
export async function cleanupNamespace(emailPrefix: string, patientLast: string): Promise<void> {
  const emailPattern = `${emailPrefix}%`;
  await query(
    `DELETE FROM audit_log WHERE user_id IN (SELECT id FROM users WHERE email LIKE $1)`,
    [emailPattern],
  );
  await query(
    `DELETE FROM note_versions WHERE created_by IN (SELECT id FROM users WHERE email LIKE $1)`,
    [emailPattern],
  );
  await query(
    `DELETE FROM notes WHERE encounter_id IN (
       SELECT e.id FROM encounters e JOIN users u ON u.id = e.provider_id WHERE u.email LIKE $1
     )`,
    [emailPattern],
  );
  await query(
    `DELETE FROM encounters WHERE provider_id IN (SELECT id FROM users WHERE email LIKE $1)`,
    [emailPattern],
  );
  await query(
    `DELETE FROM drafts WHERE provider_id IN (SELECT id FROM users WHERE email LIKE $1)`,
    [emailPattern],
  );
  await query(`DELETE FROM patients WHERE lower(last_name) = lower($1)`, [patientLast]);
  await query(`DELETE FROM users WHERE email LIKE $1`, [emailPattern]);
}

/** Minimal valid note payload for encounter creation / version appends. */
export function noteBody(marker: string) {
  return {
    subjective: `Subjective ${marker}`,
    objective: 'Not documented during this encounter.',
    assessment: `Assessment ${marker}`,
    plan: `Plan ${marker}`,
    icdCodes: [{ code: 'I10', description: 'Essential (primary) hypertension' }],
    redFlags: [],
  };
}
