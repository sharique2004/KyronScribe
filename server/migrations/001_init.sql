CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TYPE user_role AS ENUM ('provider','admin');

CREATE TABLE users (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email          text NOT NULL UNIQUE,           -- stored lowercase; app normalizes
  password_hash  text NOT NULL,
  full_name      text NOT NULL,
  credentials    text,                            -- "MD", "DO"…
  role           user_role NOT NULL,
  is_active      boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  deactivated_at timestamptz
);

CREATE TABLE patients (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name text NOT NULL,
  last_name  text NOT NULL,
  dob        date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX patients_identity_uidx ON patients (lower(first_name), lower(last_name), dob);

CREATE TABLE templates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  description text,
  prompt      text NOT NULL,                      -- structured instructions appended to system prompt
  is_deleted  boolean NOT NULL DEFAULT false,     -- soft delete: encounters reference templates
  created_by  uuid REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE encounters (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id  uuid NOT NULL REFERENCES patients(id),
  provider_id uuid NOT NULL REFERENCES users(id),
  template_id uuid REFERENCES templates(id),
  transcript  text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX encounters_provider_created_idx ON encounters (provider_id, created_at DESC); -- provider list + admin provider filter
CREATE INDEX encounters_patient_idx  ON encounters (patient_id);                            -- history retrieval tool
CREATE INDEX encounters_created_idx  ON encounters (created_at DESC);                       -- admin date-range filter

CREATE TABLE notes (            -- 1:1 with encounter; anchor for the version chain
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  encounter_id uuid NOT NULL UNIQUE REFERENCES encounters(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE note_versions (    -- append-only; NEVER updated or deleted
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id     uuid NOT NULL REFERENCES notes(id),
  version_no  integer NOT NULL,
  subjective  text NOT NULL DEFAULT '',
  objective   text NOT NULL DEFAULT '',
  assessment  text NOT NULL DEFAULT '',
  plan        text NOT NULL DEFAULT '',
  icd_codes   jsonb NOT NULL DEFAULT '[]',        -- [{code, description}]
  red_flags   jsonb NOT NULL DEFAULT '[]',        -- [{severity, text}]
  created_by  uuid NOT NULL REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (note_id, version_no)                    -- race-safe monotonic versions
);
CREATE INDEX note_versions_note_idx ON note_versions (note_id, version_no DESC);

CREATE TABLE drafts (           -- one in-flight encounter per provider (cross-device restore)
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id   uuid NOT NULL UNIQUE REFERENCES users(id),
  patient_first text NOT NULL DEFAULT '',
  patient_last  text NOT NULL DEFAULT '',
  patient_dob   date,
  template_id   uuid REFERENCES templates(id),
  transcript    text NOT NULL DEFAULT '',
  note_json     jsonb,                            -- generated-but-unsaved note incl. inline edits
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE icd10_codes (
  code        text PRIMARY KEY,                   -- e.g. 'M54.50'
  description text NOT NULL,
  category    text,
  embedding   jsonb                               -- 384-dim MiniLM vector; null until seed embeds
);

CREATE TABLE audit_log (
  id          bigserial PRIMARY KEY,
  user_id     uuid REFERENCES users(id),
  action      text NOT NULL,                      -- login, note.save, template.update, provider.deactivate, generate…
  entity_type text,
  entity_id   text,
  meta        jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_created_idx ON audit_log (created_at DESC);
CREATE INDEX audit_log_user_idx    ON audit_log (user_id, created_at DESC);
