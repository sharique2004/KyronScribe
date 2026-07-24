-- Patient identity: visible MRN, fuzzy name search, and an explicit encounter date.
-- MRN is deterministically derived from the patient uuid (stable, no counter to coordinate)
-- and surfaced everywhere a human matches a chart to a person. pg_trgm powers typo-tolerant
-- name autocomplete so a provider explicitly LINKS a note to the right patient entity
-- instead of relying on exact-triple retyping. occurred_on records the clinical date of the
-- visit (documentation can happen later); backfilled from created_at for existing rows.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TABLE patients ADD COLUMN IF NOT EXISTS mrn text
  GENERATED ALWAYS AS (upper(left(replace(id::text, '-', ''), 8))) STORED;
CREATE INDEX IF NOT EXISTS patients_mrn_idx ON patients (mrn);
CREATE INDEX IF NOT EXISTS patients_name_trgm_idx
  ON patients USING gin ((first_name || ' ' || last_name) gin_trgm_ops);

ALTER TABLE encounters ADD COLUMN IF NOT EXISTS occurred_on date;
UPDATE encounters SET occurred_on = (created_at AT TIME ZONE 'UTC')::date WHERE occurred_on IS NULL;
ALTER TABLE encounters ALTER COLUMN occurred_on SET NOT NULL;
ALTER TABLE encounters ALTER COLUMN occurred_on SET DEFAULT CURRENT_DATE;
