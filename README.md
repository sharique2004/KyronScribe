# Kyron Scribe

**AI clinical documentation platform** — a provider pastes a raw encounter transcript, and the AI streams back a structured, professional SOAP note in real time: red flags first, then Subjective / Objective / Assessment (with semantically matched ICD-10 codes) / Plan. Notes are versioned immutably, drafts survive refreshes and device switches, returning patients get context-aware notes via backend tool calls, and admins manage the roster and the prompt-template library.

Built for the Kyron Medical technical interview — requirements in [docs/CHALLENGE.md](docs/CHALLENGE.md), full product spec in [PRD.md](PRD.md).

---

## Feature map (challenge requirement → implementation)

| Challenge requirement | Where it lives | Status |
|---|---|---|
| Auth, two roles, 3 providers + 1 admin seeded | JWT (HS256) in an httpOnly cookie; per-request `is_active` check — `server/src/middleware/auth.ts`, `routes/auth.ts` | Done |
| Providers see only their own encounters | `WHERE provider_id = req.user.id` on every provider query; cross-provider access → 403 (integration-tested) | Done |
| Encounter workspace (patient, transcript, template, Generate) | `client/src/pages/provider/Workspace.tsx` + `components/workspace/*` | Done |
| Streaming SOAP via SSE, progressive render | `POST /api/generate` (SSE) → tag-parsing incremental render, section by section, token by token — `server/src/routes/generate.ts`, `client/src/api/generateStream.ts` | Done |
| ≥1 semantically matched ICD-10 code in Assessment | Model emits `<CODES>` from clinical content; provider verifies/edits | Done |
| Inline edit before save; persist to DB | Editable section cards → `POST /api/encounters` transaction | Done |
| Patient history via backend tool call (not frontend prompt-stuffing) | Anthropic tool use: model calls `get_patient_history`, server runs the DB query mid-stream and returns a `tool_result` — `server/src/services/ai/scribe.ts` | Done |
| Returning vs. first-time patient behave differently | Tool only offered when the patient exists; system prompt states "first visit" otherwise; UI transparency panel shows exactly which encounters were consulted | Done |
| Immutable versioning with author + time | Append-only `note_versions`, `UNIQUE(note_id, version_no)`, race-safe max+1 with retry — never UPDATE/DELETE | Done |
| ICD-10 search widget, 200–300+ codes, no external API | 320 ICD-10-CM codes embedded with local MiniLM (all-MiniLM-L6-v2), cosine similarity in-process, click-to-append — `server/src/services/embeddings.ts` | Done |
| Admin: all encounters, filter by provider + date range | `client/src/pages/admin/AdminEncounters.tsx` | Done |
| Admin: add / deactivate providers | Roster page + modals; deactivation takes effect on the provider's **next request** | Done |
| Admin: template CRUD; template visibly shapes generation | Four divergent seeded templates; editor with live-effect helper text | Done |
| Template edits apply to the next generation, no refresh | No caching anywhere — generation reads the template row from the DB at request time | Done |
| Drafts restored after refresh, across devices, from the DB | Debounced (800 ms) server-side autosave to a per-provider `drafts` row + localStorage mirror | Done |
| Non-happy paths (two demonstrated, three implemented) | N1 insufficient content · N2 session expiry mid-save · N3 deactivation with open draft — see below | Done |
| AWS EC2 + nginx + HTTPS, private RDS, Secrets Manager, pooling | Terraform in `infra/terraform/`, runbook in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Ready to apply |

### Pioneer features

- **Clinical red-flag pre-scan** — the model emits `<RED_FLAGS>` before the note; severity-tagged banner chips render *before* the SOAP sections finish streaming.
- **Version diff view** — word-level diff between any two versions, per section (insertions green, deletions struck-through red).
- **Context transparency panel** — after generation, shows exactly which prior encounters the AI consulted, or "First-time patient — generated without prior history."
- **Print-ready export** — a dedicated print stylesheet renders a clean clinical document (browser print → PDF).
- **Mock scribe mode** — `SCRIBE_MOCK=1` streams a realistic, template-aware, transcript-aware generation through the real SSE path (tool-call simulation included), so the full UX works with no API key. The UI shows a "Mock mode" chip.

---

## Architecture

```
Browser (React SPA)
   │ HTTPS
   ▼
nginx  (EC2 · TLS via Let's Encrypt · serves client/dist · proxies /api,
   │    proxy_buffering off for /api/generate → SSE passthrough)
   ▼ 127.0.0.1:4000
Node 20 · Express 4 + TypeScript  (systemd unit, non-root)
   ├── pg.Pool (max 10) ───────────────► AWS RDS PostgreSQL
   │                                     (private subnets; SG allows the EC2 SG only)
   ├── @anthropic-ai/sdk ─ streaming + tool use ─► Anthropic API (claude-sonnet-5)
   │      └─ get_patient_history tool → indexed DB query mid-generation
   ├── @xenova/transformers ─ MiniLM embeddings, fully in-process
   └── AWS Secrets Manager ─ boot-time secret load via EC2 instance role
```

### Stack & why

| Layer | Choice | Why |
|---|---|---|
| Backend | Express 4 + TypeScript | Boring and explainable; first-class SSE control (`res.write`); every auth/pool/stream layer is hand-visible for the walkthrough |
| Database | PostgreSQL (RDS prod / Homebrew local) | Relational fit for versions, roles, audit; JSONB only where the payload is genuinely list-shaped and attached to an immutable row; same engine dev↔prod |
| DB access | `pg` Pool + raw parameterized SQL | Pooling and schema are graded — no ORM hiding the queries. One pool per process, max 10 |
| Auth | JWT HS256 in an httpOnly SameSite=Lax cookie, bcrypt(12) | Stateless verify, no token in JS-readable storage; the per-request `is_active` lookup makes deactivation instant (scenario N3) |
| AI | `claude-sonnet-5` (env-overridable) | Interactive streaming product → first-token latency and tokens/sec dominate perceived quality; native tool-use streaming powers history injection |
| ICD search | Local MiniLM (384-dim) + cosine in Node | Semantic, deterministic, zero per-keystroke cost; at 320 codes an index is overkill. ILIKE fallback if the model can't load |
| Frontend | React 18 + Vite + Tailwind 3.4 | Fast, typed, static build served by nginx — no SSR runtime to babysit |
| Streaming | SSE over `fetch` + ReadableStream (POST) | One-way stream fits generation exactly; survives proxies; simpler to secure than WebSockets |
| Infra | Terraform + nginx + systemd + certbot | Reproducible topology matching every graded infra line |

Schema deep-dive with ERD: [docs/ERD.md](docs/ERD.md).

---

## Local quickstart

Prereqs: Node 20+, PostgreSQL 14+ running locally, `createdb` on PATH.

```bash
# 1. Database (migrate, seed demo data, embed the ICD catalog — one-time ~30s model download)
createdb kyron_scribe
cd server && cp .env.example .env   # defaults are fine for local mock-mode demo
npm install && npm run migrate && npm run seed -- --embed

# 2. API server  (SCRIBE_MOCK=1 in .env → full demo without an Anthropic key)
npm run dev                          # http://localhost:4000

# 3. Client (separate terminal)
cd client && npm install && npm run dev   # http://localhost:5173 (proxies /api → 4000)
```

### Demo accounts (all seeded, password `KyronDemo2026!`)

| Email | Name | Role |
|---|---|---|
| dr.chen@kyronhealth.demo | Dr. Sarah Chen, MD | provider |
| dr.patel@kyronhealth.demo | Dr. Raj Patel, DO | provider |
| dr.osei@kyronhealth.demo | Dr. Ama Osei, MD | provider |
| admin@kyronhealth.demo | Alex Morgan | admin |

Seeded returning patient: **Margaret Chen, DOB 1955-03-12** — two completed prior encounters under Dr. Chen, so history injection is demoable immediately.

### Environment variables (`server/.env`, see `.env.example`)

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | Postgres connection string |
| `JWT_SECRET` | yes | HS256 signing secret |
| `JWT_TTL_HOURS` | no (12) | Session lifetime |
| `PORT` | no (4000) | API port (bound to 127.0.0.1 behind nginx in prod) |
| `ANTHROPIC_API_KEY` | no | Real generation; leave blank for mock mode |
| `SCRIBE_MODEL` | no (`claude-sonnet-5`) | Generation model |
| `SCRIBE_MOCK` | no | `1` forces mock streaming (auto-on when no API key) |
| `AWS_SECRETS_NAME` | prod only | Secrets Manager secret; values override env at boot |

**Mock vs. real AI:** with no `ANTHROPIC_API_KEY` (or `SCRIBE_MOCK=1`) the server streams a realistic canned generation through the *same* SSE path — template-aware, transcript-aware, red flags, simulated history tool call, `<INSUFFICIENT>` behavior. Set a real key and `SCRIBE_MOCK=0` (or remove it) to switch to live Anthropic generation; nothing else changes.

---

## Non-happy paths (implemented and demoable)

- **N1 — no clinical content:** model emits `<INSUFFICIENT>`; the UI shows a calm amber banner, preserves the transcript, and renders no hallucinated note.
- **N2 — session expires mid-save:** the 401 is caught, the note is held in memory + localStorage, an inline re-login modal appears over the workspace, and the save **replays automatically** after sign-in. Zero loss.
- **N3 — provider deactivated with a draft open:** the next API call returns 403 `ACCOUNT_DEACTIVATED`; the UI shows a calm lockout screen; the draft row is preserved in the DB for audit; reactivation restores everything.

All three are scripted with exact steps in [docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md).

---

## Tests

Focused integration tests (vitest + supertest) run the real Express app against the local DB — no server process needed — using a throwaway namespace that cleans up after itself:

```bash
cd server && npm test    # auth · RBAC isolation · append-only versioning · draft roundtrip
```

---

## Deployment

Terraform for the full AWS topology (VPC, EC2 + Elastic IP, private-subnet RDS, SG-to-SG ingress, Secrets Manager, least-privilege instance role), plus nginx/systemd config and a step-by-step runbook — including the "RDS is actually private" proof commands: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) · [infra/](infra/).

## Repository map

```
PRD.md                  product spec (wire contracts, SSE protocol, data model)
docs/CHALLENGE.md       verbatim challenge requirements
docs/ERD.md             schema diagram + per-table rationale
docs/DEPLOYMENT.md      terraform → DNS → TLS → deploy runbook + graded proofs
docs/DEMO_SCRIPT.md     timed demo walkthrough
server/                 Express API, migrations, seed, AI pipeline, tests
client/                 React SPA
infra/                  terraform, nginx, systemd, deploy.sh
```
