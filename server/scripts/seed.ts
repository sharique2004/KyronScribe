// Idempotent seed: demo accounts (PRD §1.2), four divergent templates (§6.4), and a returning
// patient (Margaret Chen) with two completed prior encounters so history injection is demoable.
// Also loads the ICD-10 catalog if present. `npm run seed -- --embed` computes embeddings.
//
// Idempotency strategy:
//   users     — upsert on the unique email
//   templates — upsert on name (no natural unique in the schema; matched in app code)
//   patient   — insert-or-select on the identity triple unique index
//   encounters / notes — fixed UUIDs, upsert on primary key
//   versions  — upsert on (note_id, version_no)
//   icd codes — upsert on code, never clobbering an existing embedding
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import { loadConfig } from '../src/config.js';
import { getPool, query, closePool } from '../src/db.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ICD_JSON = join(HERE, '..', 'data', 'icd10_codes.json');

const DEMO_PASSWORD = 'KyronDemo2026!';
const BCRYPT_COST = 12;

// Stable UUIDs for the two seeded encounters so re-seeding upserts rather than duplicates.
const ENC_HTN = '11111111-1111-4111-8111-111111111111';
const NOTE_HTN = '11111111-1111-4111-8111-1111111111a1';
const ENC_DM = '22222222-2222-4222-8222-222222222222';
const NOTE_DM = '22222222-2222-4222-8222-2222222222a2';

// Explicit encounter dates relative to the PRD "today" of 2026-07-23.
const HTN_DATE = '2026-04-24T09:15:00Z'; // ~90 days prior
const DM_DATE = '2026-06-23T14:30:00Z'; // ~30 days prior

interface UserSeed {
  email: string;
  fullName: string;
  credentials: string | null;
  role: 'provider' | 'admin';
}

const USERS: UserSeed[] = [
  { email: 'dr.chen@kyronhealth.demo', fullName: 'Dr. Sarah Chen', credentials: 'MD', role: 'provider' },
  { email: 'dr.patel@kyronhealth.demo', fullName: 'Dr. Raj Patel', credentials: 'DO', role: 'provider' },
  { email: 'dr.osei@kyronhealth.demo', fullName: 'Dr. Ama Osei', credentials: 'MD', role: 'provider' },
  { email: 'admin@kyronhealth.demo', fullName: 'Alex Morgan', credentials: null, role: 'admin' },
];

interface TemplateSeed {
  name: string;
  description: string;
  prompt: string;
}

// These are appended to the base scribe system prompt under "ENCOUNTER TYPE INSTRUCTIONS".
// They are deliberately divergent so switching templates produces visibly different notes.
const TEMPLATES: TemplateSeed[] = [
  {
    name: 'General SOAP',
    description: 'Balanced default for routine office visits across specialties.',
    prompt: `This is a general office visit. Produce a balanced, well-proportioned SOAP note suitable for primary or general care.

SUBJECTIVE: Lead with the chief complaint in the patient's own framing, then the history of present illness in chronological order — onset, location, duration, character, aggravating/relieving factors, and associated symptoms. Include only the review of systems elements the transcript actually raises; do not pad with negatives that were never discussed.

OBJECTIVE: Record vitals and exam findings exactly as stated. If the transcript contains no objective findings or measured vitals, write "Not documented during this encounter." Never infer or invent a physical exam.

ASSESSMENT: State the working diagnosis or problem in clinical terms, with brief supporting reasoning drawn from the subjective and objective data. Keep the differential tight and relevant — this is a routine visit, not a comprehensive workup. Attach the most specific ICD-10 code the documentation supports.

PLAN: Give concrete, itemized next steps — medications with dose/route/frequency when specified, ordered tests, referrals, patient education, and a clear follow-up interval. Keep each item on its own line for scannability.

Register: concise professional clinical prose, standard abbreviations, no filler. Favor clarity a covering colleague could act on at a glance.`,
  },
  {
    name: 'Orthopedic Follow-up',
    description: 'Musculoskeletal follow-up: structured exam, ROM, strength, gait, imaging review.',
    prompt: `This is an orthopedic / musculoskeletal follow-up visit. Emphasize the objective MSK exam and interval change since the last visit.

SUBJECTIVE: Focus on the affected joint or region. Document interval change in pain (use a 0–10 scale if stated), functional limitations (weight-bearing, range of activity, work/sport impact), adherence to prior treatment (PT, bracing, activity modification, medications), and any new mechanical symptoms (locking, catching, instability, giving-way).

OBJECTIVE: This is the centerpiece — structure it explicitly by exam component. Report, per the affected region and only where stated: Inspection (swelling, effusion, deformity, ecchymosis); Palpation (point tenderness, warmth); Range of motion (active and passive, in degrees when given); Strength (graded /5); Special/provocative tests by name with result; Neurovascular status distally; and Gait if assessed. Then summarize any imaging reviewed (X-ray/MRI/CT) with the specific findings discussed. If a component was not examined, omit it rather than guessing.

ASSESSMENT: State the orthopedic diagnosis with laterality and stage/grade if known, plus healing or recovery trajectory. Use the most specific ICD-10 code including laterality where supported.

PLAN: Address activity restrictions and progression, PT parameters, bracing/DME, injections or medications, imaging or surgical decision-making, and return-to-activity or return-to-work guidance with a follow-up interval.`,
  },
  {
    name: 'New Patient Evaluation',
    description: 'Comprehensive intake: full history, ROS, PMH/PSH/FamHx/SocHx, broad differential.',
    prompt: `This is a comprehensive new-patient evaluation. Be thorough — this note establishes the baseline record.

SUBJECTIVE: Build a complete history. Begin with the chief complaint and a full HPI. Then, in clearly labeled sub-sections, capture everything the transcript provides: Past Medical History, Past Surgical History, Medications and Allergies, Family History, and Social History (tobacco/alcohol/substances, occupation, living situation, exercise). Close with a Review of Systems summarized by system, noting pertinent positives and pertinent negatives that were actually discussed. Where the transcript is silent on a domain, mark it "Not obtained" rather than fabricating.

OBJECTIVE: Full documented vitals and a general multi-system exam limited to what was performed. If no exam is documented, write "Not documented during this encounter."

ASSESSMENT: Because this is an initial evaluation, articulate a genuine differential — list the leading diagnosis with supporting evidence, then 1–3 alternatives worth excluding, each with a one-line rationale. Enumerate every active problem. Attach the most specific supportable ICD-10 code to each distinct problem.

PLAN: Organize by problem. For each: diagnostics ordered, empiric treatment started, referrals, counseling, and follow-up. Include health-maintenance items (screening, immunizations) when relevant to a new-patient baseline.`,
  },
  {
    name: 'Urgent Care Visit',
    description: 'Concise acute visit: disposition-first plan with explicit return precautions.',
    prompt: `This is an urgent care / acute visit. Be concise and disposition-oriented — the reader needs the decision, fast.

SUBJECTIVE: A tight, focused HPI centered on the single acute complaint: onset, severity, trajectory, and the pertinent positives and negatives that drive risk stratification (e.g., for chest pain: exertional relationship, radiation, associated dyspnea/diaphoresis). Skip unrelated chronic history unless it changes management today.

OBJECTIVE: Vitals first and prominent — they anchor acuity. Then the focused exam of the relevant system(s) only. If not documented, state "Not documented during this encounter."

ASSESSMENT: One or two lines: the working diagnosis and an explicit acuity judgment (stable and appropriate for outpatient management vs. warranting escalation). Attach the most specific supportable ICD-10 code.

PLAN — lead with DISPOSITION: state up front whether the patient is discharged home, referred, or directed to the emergency department. Then treatment given/prescribed, and finally an explicit, bulleted RETURN PRECAUTIONS section naming the specific symptoms that should prompt immediate return or a call to 911. Keep the entire note skimmable in under a minute.`,
  },
];

interface VersionSeed {
  encounterId: string;
  noteId: string;
  date: string;
  transcript: string;
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
  icdCodes: { code: string; description: string }[];
}

const HTN_ENCOUNTER: VersionSeed = {
  encounterId: ENC_HTN,
  noteId: NOTE_HTN,
  date: HTN_DATE,
  transcript: `Provider: Good morning, Margaret, good to see you back. How have things been since we started the lisinopril?
Patient: Pretty good. I've been taking it every morning like you said. No cough this time, which is nice — that other pill years ago made me cough constantly.
Provider: Glad to hear it. Any dizziness, especially standing up?
Patient: A little the first week, but that settled. I've also been walking most days, about 25 minutes, and cutting back on the salt like we talked about.
Provider: That's excellent. Any chest pain, shortness of breath, headaches, swelling in the ankles?
Patient: No, none of that. I feel fine, honestly.
Provider: Let's check your pressure. ... 128 over 78 today. Last visit you were 152 over 94, so that's a real improvement. Heart sounds are regular, lungs are clear, no swelling in the legs.
Patient: That's much better than before.
Provider: It is. Let's keep the lisinopril at 10 milligrams, keep up the walking and the low-salt diet, and I'll get a basic metabolic panel to check your kidneys and potassium. Come back in three months.`,
  subjective: `62-year-old woman returning for hypertension follow-up, six weeks after initiation of lisinopril 10 mg daily. Reports good adherence, taking the medication each morning. Denies the dry cough she experienced with a prior ACE inhibitor years ago. Notes mild lightheadedness in the first week that has since resolved. Has adopted lifestyle changes — walking ~25 minutes most days and reducing dietary sodium. Denies chest pain, dyspnea, headache, palpitations, or lower-extremity edema.`,
  objective: `BP 128/78 (prior visit 152/94). Cardiovascular: regular rate and rhythm, no murmurs. Pulmonary: clear to auscultation bilaterally. Extremities: no peripheral edema.`,
  assessment: `Essential hypertension, improved and well-controlled on lisinopril 10 mg daily. Blood pressure has fallen from 152/94 to 128/78 with combined pharmacologic and lifestyle management. Medication is well tolerated without the ACE-inhibitor cough seen previously.`,
  plan: `1. Continue lisinopril 10 mg PO daily.
2. Continue lifestyle modification — regular walking and dietary sodium restriction.
3. Order basic metabolic panel to assess renal function and potassium on ACE inhibitor.
4. Home blood-pressure monitoring; bring log to next visit.
5. Follow up in 3 months, sooner if symptoms develop.`,
  icdCodes: [{ code: 'I10', description: 'Essential (primary) hypertension' }],
};

const DM_ENCOUNTER: VersionSeed = {
  encounterId: ENC_DM,
  noteId: NOTE_DM,
  date: DM_DATE,
  transcript: `Provider: Hi Margaret. We're here today mostly about your diabetes and cholesterol — your A1c came back at 7.8.
Patient: Is that bad? I thought I was doing okay.
Provider: It's a little above where we'd like it — we aim for under 7 for most people. How's the metformin going?
Patient: Fine, no stomach trouble anymore now that I take it with food. I check my sugar most mornings, usually runs in the 140s to 160s.
Provider: Okay. Any numbness or tingling in your feet? Vision changes?
Patient: My feet feel normal. Vision's the same. I did have my eyes checked last month, they said it was fine.
Provider: Good. And your cholesterol panel showed an LDL of 138, which we should bring down. Are you still on the atorvastatin?
Patient: Yes, 20 milligrams at night. No muscle aches or anything.
Provider: Let's look at your feet today. ... Pulses are good, sensation to monofilament is intact, no ulcers or skin breakdown. Let's increase the metformin to 1000 milligrams twice a day, keep the atorvastatin, and I'll recheck your A1c and lipids in three months. Keep up the walking and watch the carbohydrates.`,
  subjective: `62-year-old woman with type 2 diabetes mellitus and hyperlipidemia, here for management. Reports good tolerance of metformin now that she takes it with food; prior GI upset has resolved. Home fasting glucose typically 140–160 mg/dL. Denies polyuria, polydipsia, blurred vision, or lower-extremity numbness/tingling. Recent dilated eye exam last month reported normal. Adherent to atorvastatin 20 mg nightly without myalgias. Recent labs: A1c 7.8%, LDL 138 mg/dL.`,
  objective: `Diabetic foot exam: dorsalis pedis and posterior tibial pulses 2+ bilaterally, protective sensation intact to 10 g monofilament, no ulceration or skin breakdown. Remainder of exam deferred.`,
  assessment: `1. Type 2 diabetes mellitus, suboptimally controlled — A1c 7.8% above the individualized target of <7%. No evidence of peripheral neuropathy or foot complication on exam; retinal screen recently normal.
2. Hyperlipidemia — LDL 138 mg/dL above goal on atorvastatin 20 mg; statin well tolerated.`,
  plan: `1. Increase metformin to 1000 mg PO BID with meals.
2. Continue atorvastatin 20 mg PO nightly; reinforce adherence.
3. Continue home glucose monitoring; review log at next visit.
4. Reinforce medical nutrition therapy — carbohydrate awareness and continued daily walking.
5. Recheck A1c and fasting lipid panel in 3 months.
6. Continue annual dilated retinal exam and daily foot self-checks.`,
  icdCodes: [
    { code: 'E11.9', description: 'Type 2 diabetes mellitus without complications' },
    { code: 'E78.5', description: 'Hyperlipidemia, unspecified' },
  ],
};

async function seedUsers(passwordHash: string): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  for (const u of USERS) {
    const { rows } = await query<{ id: string }>(
      `INSERT INTO users (email, password_hash, full_name, credentials, role, is_active)
       VALUES ($1, $2, $3, $4, $5, true)
       ON CONFLICT (email) DO UPDATE SET
         password_hash = EXCLUDED.password_hash,
         full_name     = EXCLUDED.full_name,
         credentials   = EXCLUDED.credentials,
         role          = EXCLUDED.role,
         is_active     = true,
         deactivated_at = NULL
       RETURNING id`,
      [u.email, passwordHash, u.fullName, u.credentials, u.role],
    );
    ids.set(u.email, rows[0]!.id);
  }
  console.log(`[seed] users: ${ids.size}`);
  return ids;
}

async function seedTemplates(adminId: string): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  for (const t of TEMPLATES) {
    const existing = await query<{ id: string }>('SELECT id FROM templates WHERE name = $1', [t.name]);
    const found = existing.rows[0];
    if (found) {
      await query(
        `UPDATE templates SET description = $2, prompt = $3, is_deleted = false, updated_at = now() WHERE id = $1`,
        [found.id, t.description, t.prompt],
      );
      ids.set(t.name, found.id);
    } else {
      const inserted = await query<{ id: string }>(
        `INSERT INTO templates (name, description, prompt, created_by) VALUES ($1, $2, $3, $4) RETURNING id`,
        [t.name, t.description, t.prompt, adminId],
      );
      ids.set(t.name, inserted.rows[0]!.id);
    }
  }
  console.log(`[seed] templates: ${ids.size}`);
  return ids;
}

async function seedPatient(): Promise<string> {
  await query(
    `INSERT INTO patients (first_name, last_name, dob) VALUES ($1, $2, $3)
     ON CONFLICT (lower(first_name), lower(last_name), dob) DO NOTHING`,
    ['Margaret', 'Chen', '1955-03-12'],
  );
  const { rows } = await query<{ id: string }>(
    `SELECT id FROM patients WHERE lower(first_name) = lower($1) AND lower(last_name) = lower($2) AND dob = $3`,
    ['Margaret', 'Chen', '1955-03-12'],
  );
  console.log('[seed] patient: Margaret Chen');
  return rows[0]!.id;
}

async function seedEncounter(
  v: VersionSeed,
  patientId: string,
  providerId: string,
  templateId: string,
): Promise<void> {
  await query(
    `INSERT INTO encounters (id, patient_id, provider_id, template_id, transcript, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $6)
     ON CONFLICT (id) DO UPDATE SET
       patient_id = EXCLUDED.patient_id,
       provider_id = EXCLUDED.provider_id,
       template_id = EXCLUDED.template_id,
       transcript = EXCLUDED.transcript,
       created_at = EXCLUDED.created_at,
       updated_at = EXCLUDED.updated_at`,
    [v.encounterId, patientId, providerId, templateId, v.transcript, v.date],
  );
  await query(
    `INSERT INTO notes (id, encounter_id, created_at) VALUES ($1, $2, $3)
     ON CONFLICT (id) DO UPDATE SET encounter_id = EXCLUDED.encounter_id`,
    [v.noteId, v.encounterId, v.date],
  );
  await query(
    `INSERT INTO note_versions
       (note_id, version_no, subjective, objective, assessment, plan, icd_codes, red_flags, created_by, created_at)
     VALUES ($1, 1, $2, $3, $4, $5, $6::jsonb, '[]'::jsonb, $7, $8)
     ON CONFLICT (note_id, version_no) DO UPDATE SET
       subjective = EXCLUDED.subjective,
       objective  = EXCLUDED.objective,
       assessment = EXCLUDED.assessment,
       plan       = EXCLUDED.plan,
       icd_codes  = EXCLUDED.icd_codes,
       created_by = EXCLUDED.created_by,
       created_at = EXCLUDED.created_at`,
    [
      v.noteId,
      v.subjective,
      v.objective,
      v.assessment,
      v.plan,
      JSON.stringify(v.icdCodes),
      providerId,
      v.date,
    ],
  );
}

interface IcdEntry {
  code: string;
  description: string;
  category?: string | null;
}

async function seedIcdCatalog(): Promise<void> {
  if (!existsSync(ICD_JSON)) {
    console.log('[seed] icd10_codes.json not found — skipping ICD catalog (A2 not present yet)');
    return;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(ICD_JSON, 'utf8'));
  } catch (err) {
    console.warn('[seed] icd10_codes.json is not valid JSON — skipping', err);
    return;
  }
  if (!Array.isArray(parsed)) {
    console.warn('[seed] icd10_codes.json is not an array — skipping');
    return;
  }
  const entries = parsed.filter(
    (e): e is IcdEntry =>
      typeof e === 'object' &&
      e !== null &&
      typeof (e as IcdEntry).code === 'string' &&
      typeof (e as IcdEntry).description === 'string',
  );
  if (entries.length === 0) {
    console.warn('[seed] icd10_codes.json contained no valid entries — skipping');
    return;
  }
  const codes = entries.map((e) => e.code);
  const descriptions = entries.map((e) => e.description);
  const categories = entries.map((e) => e.category ?? null);
  // Upsert on code; deliberately do NOT touch `embedding` so previously computed vectors survive.
  await query(
    `INSERT INTO icd10_codes (code, description, category)
     SELECT c, d, cat FROM unnest($1::text[], $2::text[], $3::text[]) AS t(c, d, cat)
     ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description, category = EXCLUDED.category`,
    [codes, descriptions, categories],
  );
  console.log(`[seed] icd catalog: ${entries.length} codes upserted`);
}

async function runEmbeddings(): Promise<void> {
  try {
    // Non-literal specifier: A5 builds this module later, so we resolve it at runtime only
    // (a literal import would fail typecheck until embeddings.ts exists).
    const specifier = '../src/services/embeddings.js';
    const mod: unknown = await import(specifier);
    const embedAll = (mod as { embedAll?: (pool: unknown) => Promise<number> }).embedAll;
    if (typeof embedAll !== 'function') {
      console.log('[seed] embeddings module present but has no embedAll() export — skipping');
      return;
    }
    const n = await embedAll(getPool());
    console.log(`[seed] embeddings: computed ${n} vector(s)`);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | undefined)?.code;
    if (code === 'ERR_MODULE_NOT_FOUND' || code === 'MODULE_NOT_FOUND') {
      console.log('[seed] embeddings module not present yet');
    } else {
      console.error('[seed] embedding step failed (continuing)', err);
    }
  }
}

async function main(): Promise<void> {
  const embed = process.argv.includes('--embed');
  await loadConfig();

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, BCRYPT_COST);
  const userIds = await seedUsers(passwordHash);
  const adminId = userIds.get('admin@kyronhealth.demo')!;
  const chenId = userIds.get('dr.chen@kyronhealth.demo')!;

  const templateIds = await seedTemplates(adminId);
  const generalId = templateIds.get('General SOAP')!;

  const patientId = await seedPatient();
  await seedEncounter(HTN_ENCOUNTER, patientId, chenId, generalId);
  await seedEncounter(DM_ENCOUNTER, patientId, chenId, generalId);
  console.log('[seed] encounters: 2 (Margaret Chen — HTN follow-up, T2DM management)');

  await seedIcdCatalog();

  if (embed) await runEmbeddings();

  console.log('[seed] done');
  await closePool();
}

main().catch((err: unknown) => {
  console.error('[seed] error', err);
  process.exit(1);
});
