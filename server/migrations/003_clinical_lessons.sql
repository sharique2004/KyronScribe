-- Clinical lessons: the self-improving diagnostic memory (reflection + retrieval loop).
-- When a patient's diagnosis is materially revised between encounters, the AI reflects on
-- both encounters and stores a "lesson" (what was missed, what workup would have caught it).
-- Future generations retrieve semantically relevant lessons and inject them into the prompt,
-- so behaviour provably improves with use — no model retraining involved.
CREATE TABLE IF NOT EXISTS clinical_lessons (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id         uuid NOT NULL REFERENCES patients(id),
  from_encounter_id  uuid NOT NULL REFERENCES encounters(id),
  to_encounter_id    uuid NOT NULL REFERENCES encounters(id),
  initial_dx         text NOT NULL,
  revised_dx         text NOT NULL,
  missed_signals     text NOT NULL,
  recommended_workup text NOT NULL,
  lesson_summary     text NOT NULL,
  embedding          jsonb,          -- 384-dim MiniLM vector over summary+signals; null until embedded
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (from_encounter_id, to_encounter_id)  -- one lesson per revision pair (idempotent trigger)
);

-- Chart panel path: lessons for one patient, newest first.
CREATE INDEX IF NOT EXISTS clinical_lessons_patient_idx ON clinical_lessons (patient_id, created_at DESC);
