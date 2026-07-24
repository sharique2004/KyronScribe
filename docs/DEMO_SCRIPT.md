# Kyron Scribe — Demo Script (15-minute cut)

One video: **behavioral first (~4 min), then the walkthrough (~11 min)**. Talking-point anchors in **bold**. Record against the live deployment: `https://kyron.shariquekhatri.com`.

---

## Before recording (pre-stage, off camera — 5 minutes)

1. **Mic permission**: do one throwaway dictation as dr.chen so the browser permission prompt never appears on camera.
2. **Pre-stage the self-improving lesson** so it exists before you record: as dr.chen, save two encounters for **Casey Rivers, 05/05/1970** —
   - Encounter 1 transcript: *"Low back pain after lifting boxes, worse with movement, no neuro deficits. Lumbar paraspinal tenderness."* → Generate → Save.
   - New encounter, same patient: *"Back pain resolved. Now recurrent severe unilateral throbbing headaches with photophobia and nausea. Neuro exam nonfocal."* → Generate → Save. (The reflection runs in the background within seconds.)
3. **Complete the onboarding tours** for dr.chen and admin (or keep them — but skipping on camera costs seconds). The signup segment shows a tour organically.
4. **Second browser window** signed in as **admin@kyronhealth.demo**, sitting on the Providers page (for N3 + template live-effect + approvals).
5. DevTools closed but ready (you'll open Application → Cookies once, for N2).
6. Wi-Fi flaky? Record on a hotspot.

---

## 0:00 — Behavioral (camera on you, ~55 seconds each)

1. What makes you unique; what you'd bring to Kyron's culture (speed + quality + team).
2. Outcome-oriented vs effort-oriented, and why it matters at a startup.
3. A time you rapidly learned an unfamiliar technology under pressure — process and outcome.
4. How you decide what to build first in a large ambiguous scope — with a real example.

Transition line: *"Let me show you what I built."* → screen share.

## 4:00 — Login & auth (30 s)

Sign in as **dr.chen@kyronhealth.demo** / `KyronDemo2026!`. While it loads: **"Auth is a JWT in an httpOnly SameSite=Lax cookie — nothing token-readable from JS. Every request re-checks `is_active` in the DB, so deactivation is instant; you'll see that live."** Point at the padlock once: **"Live on EC2 behind nginx, real Let's Encrypt cert."**

## 4:30 — The flagship: dictation → returning-patient generation (3 min)

1. New Encounter: **Margaret / Chen / 03-12-1955** → **"Returning · 2 prior encounters"** badge. **"Live identity lookup, not client state."**
2. Click **Dictate** and *speak* the transcript instead of pasting: *"Margaret returns for her blood pressure follow-up. Taking lisinopril 10 milligrams daily. Home readings around 132 over 80. Denies chest pain, headache, dizziness. BP today 130 over 78, heart rate 72. Continue current regimen, recheck in 3 months with a BMP."* → Stop → text appears. **"Recorded in the browser, transcribed server-side by Gemini's multimodal input — same provider-agnostic AI layer as generation."**
3. **Generate note.** Narrate in order:
   - **"Reviewing 2 prior encounters…"** → **"the model called the `get_patient_history` tool; the server ran one indexed query mid-stream and returned prior notes as a tool result. History never touches the frontend prompt."**
   - Sections filling **token by token** → **"progressive SSE render — no spinner-then-dump. Gemini Flash for first-token latency and native function calling, with Anthropic and a mock as config-swap fallbacks."**
   - **Context used** panel lists the two consulted encounters; the note references prior diagnoses. **"A first-time patient shows 'generated without prior history' here — differential behavior you can see."**
4. Click into a section, tweak one sentence (inline edit). ICD widget: search **"type 2 diabetes"** → click **E11.9** → chip appends. **"320 ICD-10-CM codes embedded locally with MiniLM, cosine in-process — no external API."**
5. **Save note.**

## 7:30 — Versioning & diff (45 s)

On the detail page: version rail (**v1 · author · time**). Edit → add a line to Plan → **Save as new version** → v2; **Compare** → word-level diff. **"Append-only `note_versions`, UNIQUE(note_id, version_no), race-safe max+1 — prior versions are never touched, all in RDS Postgres."**

## 8:15 — N1: no clinical content (40 s)

New Encounter, new patient (Harold / Finch / 09-30-1962), transcript: *"We chatted about the weather and her cat Whiskers. No medical topics came up."* → Generate → amber banner. **"The model is contractually allowed to refuse — `<INSUFFICIENT>` instead of a hallucinated note, transcript preserved."**

## 8:55 — Red flags + N2: session expiry, zero loss (90 s)

1. Same patient, transcript: *"Crushing substernal chest pain radiating to the left arm for 45 minutes, diaphoresis, nausea. BP 158/95, HR 104."* → Generate → **red-flag chips render before the note finishes.**
2. DevTools → Application → Cookies → delete `kyron_session`. **"A 12-hour token just expired mid-encounter."** Click **Save note** → re-login modal *over* the workspace → sign in → **save replays automatically**. **"Zero data loss — the failed action sits in a retry queue; drafts are also autosaved server-side every keystroke."**

## 10:25 — Admin: oversight, N3, live templates (1 min 45 s)

Switch to the admin window.

1. **Encounters**: filter by provider + date range (they compose); open one **read-only**. **"Admins see everything, clinically edit nothing."**
2. **N3**: in the provider window, sign in as **dr.patel**, type a draft ("Draft saved" appears). In the admin window **Deactivate** Dr. Patel → provider window's next autosave → **calm lockout screen, draft preserved in Postgres**. Reactivate. **"That's the per-request `is_active` check."**
3. **Templates**: edit General SOAP's prompt, Save. In the provider window (no refresh) **Generate** → output reflects the edit. **"Zero template caching — generation reads the template row at request time."**

## 12:10 — Signup → approval → onboarding (60 s)

Sign out → **Request access** → apply (any email) → try logging in → **"Application under review"**. **"Rejected applicants get the same generic 401 as a wrong password — status never leaks."** Admin window: **Pending applications** → **Approve** → sign in as the applicant → **role-aware onboarding tour** on first login (admins get an oversight version; **Replay tour** lives in the user menu). Stored in RDS, follows the user across devices.

## 13:10 — The self-improving loop (60 s, pre-staged)

1. Open Casey Rivers' second encounter → the **Diagnostic revisions** card: initial → revised dx, **missed signals**, **recommended workup**, the lesson. **"On save, the system detected the diagnostic revision and had the AI reflect on both encounters; the lesson is embedded with the same local vector engine as the ICD search."**
2. New Encounter, brand-new patient: *"New patient with recurrent severe morning headaches with photophobia and nausea."* → Generate → **"Applying learned diagnostic pattern"** chip + **Learned patterns applied** in the context panel. **"No model retraining — reflected lessons accumulate in Postgres and are retrieved semantically into future prompts. The system provably improves with use."**

## 14:10 — Infra proofs (45 s, cite [DEPLOYMENT.md](DEPLOYMENT.md) §7)

- **RDS is private**: AWS console shows *Publicly accessible: No*; `nc -w2 <rds-endpoint> 5432` times out from a laptop, connects from EC2 — SG-to-SG ingress only.
- **Secrets**: one Secrets Manager secret, fetched at boot via a scoped instance role; no `.env` on the box, nothing in the repo.
- **Reverse proxy + pooling**: node binds 127.0.0.1:4000 only, nginx terminates TLS and disables buffering on `/api/generate`; one `pg.Pool` (max 10) per process.

## 14:55 — ERD close (30 s, [ERD.md](ERD.md) open)

**"`notes` anchors the version chain so `encounters` stays about the visit; UNIQUE(note_id, version_no) makes concurrent saves race-safe; drafts are a separate mutable table so scratch state never touches the immutable record; JSONB only on the signed historical artifact; every index maps to a named query path."** Close: `cd server && npm test` — **28 green integration tests**.
