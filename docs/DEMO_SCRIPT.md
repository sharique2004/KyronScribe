# Kyron Scribe — Demo Script

A timed walkthrough hitting every graded criterion. Total runtime ~12 minutes at a relaxed pace.
Setup before recording: both servers running (`server: npm run dev`, `client: npm run dev`), DB freshly seeded, browser at `http://localhost:5173`, logged out. Mock mode is fine — the streaming path is identical; the "Mock mode" chip is honest labeling, mention it once and move on.

> Talking-point anchors are in **bold**. Every claim below was verified end-to-end in integration testing.

---

## 0:00 — Login & auth story (1 min)

1. Show the login page. Sign in as **dr.chen@kyronhealth.demo** / `KyronDemo2026!` (the demo-accounts panel is right there).
2. Say: **"Auth is a JWT in an httpOnly SameSite=Lax cookie — nothing token-shaped in JS-readable storage. Every request re-checks `is_active` in the DB, which is what makes instant deactivation work; you'll see that later."**

## 1:00 — Returning-patient generation: the flagship (3 min)

1. In New Encounter, type **Margaret / Chen / 03-12-1955**. The **"Returning · 2 prior encounters"** badge appears with "Last seen Jun 23, 2026" — that's a live identity lookup, not client state.
2. Keep template **General SOAP**. Paste a BP-follow-up transcript (e.g. "Margaret returns for her blood pressure follow-up. Taking lisinopril 10 mg daily. Home readings ~132/80. Denies chest pain, headache, dizziness. BP today 130/78, HR 72. Continue current regimen, recheck in 3 months with BMP.").
3. Click **Generate note**. Narrate what's on screen, in order:
   - status line **"Reviewing 2 prior encounters…"** — **"the model just called the `get_patient_history` tool; the server ran one indexed DB query mid-stream and returned prior notes as a tool result. History never touches the frontend prompt."**
   - sections filling **token by token** — **"progressive SSE render, not spinner-then-dump. Live generation runs on Gemini Flash — chosen for streaming latency, native function calling, and a generous free tier — behind a provider-agnostic AI layer with Anthropic and mock as drop-in fallbacks."**
   - after completion, the **Context used** panel lists exactly the two prior encounters the AI consulted — **"differential behavior you can see: a first-time patient shows 'generated without prior history' here instead."**
   - the Subjective references prior diagnoses (E11.9) — history integration, clinically appropriate.
4. **Edit inline** — click into Subjective, tweak a sentence.
5. **ICD widget** — search "type 2 diabetes without complications" → top-8 semantic matches with scores → click **E11.9** → chip appends to Assessment. **"320 ICD-10-CM codes embedded locally with MiniLM; cosine similarity in-process; no external API, no per-keystroke cost."**
6. **Save note** → lands on the encounter detail page.

## 4:00 — Versioning, diff, print (1.5 min)

1. On the detail page: version rail shows **v1 · Dr. Sarah Chen · timestamp**.
2. Click **Edit**, append a line to the Plan, **Save as new version** → v2 appears; v1 remains. **"Append-only `note_versions` table — UNIQUE(note_id, version_no), race-safe max+1. Prior versions are never updated or deleted, and it's all in Postgres."**
3. Click **Compare** → word-level **diff view** per section, additions green. 
4. Click **Print** → clean clinical document. (Pioneer features: diff + print + the red-flag banner you'll see next.)

## 5:30 — N1: no clinical content (1 min)

1. Back to New Encounter. New patient (e.g. Harold / Finch / 09-30-1962), transcript: *"We chatted about the weather and her cat Whiskers. No medical topics came up at all."*
2. Generate → **amber banner**: "No clinically meaningful content identified… The transcript was preserved — add detail and generate again." **"The model is contractually allowed to refuse: it emits `<INSUFFICIENT>` instead of hallucinating a SOAP note, and the transcript is untouched."**

## 6:30 — Red flags + N2: session expiry mid-save, zero loss (2 min)

1. Same patient, replace the transcript with a chest-pain story: *"Crushing substernal chest pain radiating to the left arm for 45 minutes, diaphoresis, nausea. BP 158/95, HR 104."*
2. Generate → the **"Clinical red flags detected"** banner with severity chips renders **before the note finishes streaming** — the model pre-scans and emits flags first.
3. Now expire the session: DevTools → Application → Cookies → delete `kyron_session`. (Narrate: **"simulating a 12-hour token expiring mid-encounter."**)
4. Click **Save note** → the **re-login modal** appears *over* the workspace: "Your unsaved note is held in this browser. After you sign in, it will be saved automatically."
5. Re-enter the password → sign in → **the save replays automatically** and lands on the saved encounter. **"Zero data loss: the failed action sits in a retry queue, with a localStorage mirror as belt-and-suspenders."**

## 8:30 — Admin tour (2.5 min)

Sign out; sign in as **admin@kyronhealth.demo**.

1. **Encounters** — all providers' encounters; filter by provider **and** date range (they compose). Click a row → **read-only** note view with a version picker and the source transcript. **"Admins see everything but clinically edit nothing."**
2. **Providers** — click **Add provider**, create an account (password shown once). Sign out, sign in as that new provider to prove it's live, then back to admin.
3. **N3 — deactivation with an open draft**: in one browser, sign in as **dr.patel** and start typing a draft (the "Draft saved" indicator confirms the server autosave). In another window as admin, click **Deactivate** on Dr. Patel. Back in Patel's window, the next keystroke's autosave hits the API → **calm lockout screen**: "Your account has been deactivated. Your work has been preserved." **"The per-request `is_active` check made that instant — and the draft row is still in Postgres for audit. Reactivate, and everything is back."**
4. **Templates** — open **General SOAP**; note the helper: *"Template changes apply to every provider's next generation immediately — no refresh needed."* Edit the prompt (or name), Save.
5. **Live-effect proof**: with a provider workspace already open in the other window (do not refresh), click **Generate** — the output reflects the updated template. **"No template caching anywhere: generation reads the template row from the DB at request time."** Also flip the template selector between the four seeded templates (Ortho / New Patient / Urgent Care) to show visibly different note structure.
6. Optional: **draft cross-device** — with a draft open as dr.chen, open an incognito window, sign in as dr.chen → the same draft state (including a generated-but-unsaved note) is restored **from the DB**, toast: "Draft restored from your last session."

## 11:00 — Infrastructure proof points (1 min, cite [DEPLOYMENT.md](DEPLOYMENT.md) §7 "The graded proofs")

Narrate over the terraform/nginx files or the live AWS deployment:

- **RDS is private**: `nc -w2 <rds-endpoint> 5432` times out from a laptop, succeeds from the EC2 box (§7.1). Security-group ingress is **SG-to-SG** — only the EC2 SG can reach 5432.
- **HTTPS with a real cert**: green padlock, Let's Encrypt via certbot; HTTP redirects (§7).
- **Secrets**: single Secrets Manager secret, fetched at boot via the **instance role** — no static AWS keys, nothing in the repo; `.env` is gitignored and `.env.example` has placeholders only.
- **Reverse proxy**: nginx serves the static client and proxies `/api`; node binds 127.0.0.1:4000 only, `proxy_buffering off` on `/api/generate` so SSE streams through.
- **Pooling**: one `pg.Pool` (max 10) per process — no per-request connections.

## 12:00 — ERD talking points (30 s, have [ERD.md](ERD.md) open)

- **`notes` between `encounters` and `note_versions`**: a stable anchor for the version chain; the encounter stays about the visit event.
- **`UNIQUE(note_id, version_no)`** makes concurrent saves race-safe (insert max+1, retry on conflict — covered by an integration test).
- **Drafts are a separate mutable table** (one row per provider) so scratch state never mixes with the immutable clinical record.
- **JSONB only on `note_versions.icd_codes` / `red_flags`** — part of the signed historical artifact — while `icd10_codes` remains the normalized search catalog with embedded vectors.
- **Every index maps to a named query path** (provider list, admin date filter, history tool, version lookup, audit).

Close: `cd server && npm test` — 23 green integration tests: auth, provider isolation, append-only versioning, draft roundtrip.
