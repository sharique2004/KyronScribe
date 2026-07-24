-- 002: self-service signup + approval lifecycle + onboarding tour state.
--
-- approval_status governs the applicant gate: a self-signup lands as 'pending'
-- (is_active FALSE) and only an admin approval flips it to 'approved' (+ is_active TRUE).
-- Legacy/seeded rows default to 'approved' so existing demo accounts keep working
-- unchanged. onboarded_at is NULL until the provider finishes (or replays) the guided
-- tour — NULL for seeded rows too, so demo accounts get the tour exactly once.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS approval_status text NOT NULL DEFAULT 'approved'
    CHECK (approval_status IN ('pending','approved','rejected'));

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS onboarded_at timestamptz;

-- Admin pending-list path: partial index keeps the "who needs review?" query fast
-- without indexing the (large, stable) approved/rejected majority.
CREATE INDEX IF NOT EXISTS users_pending_approval_idx
  ON users (approval_status)
  WHERE approval_status = 'pending';
COMMENT ON INDEX users_pending_approval_idx IS
  'Supports the admin pending-applicant list (GET /api/admin/providers, pending-first).';
