# Kyron Medical — Technical Interview: AI Clinical Scribe Platform (verbatim requirements)

> This file is the source-of-truth requirements list. Verification agents audit the build against THIS document.

Deadline: Thursday July 23, 2026 at 5PM EST.

## Overview
Build a provider-facing AI clinical documentation platform. The end user is a physician or clinical staff member. Core workflow: a provider either pastes a raw encounter transcript (verbatim record of what was discussed during a visit), or types freeform clinical observations, and the AI transforms that input into a structured, professional SOAP note (Subjective, Objective, Assessment, Plan), including suggested ICD-10 diagnosis codes based on the clinical content. The product must feel polished enough that a real physician would trust it with their clinical workflow.

## Core Requirements

### Authentication and Multi-Role Access
- Real login system with two distinct roles: Provider and Admin.
- Providers can only see and interact with their own encounters.
- Admins can view all providers' encounters, manage the provider roster, and modify note templates.
- Hard-code at least three provider accounts and one admin account for demo purposes.
- Use JWTs or session tokens; be prepared to explain every layer of the auth implementation.

### Encounter Workspace (Provider View)
- Start a new encounter by entering the patient's first name, last name, and date of birth.
- Paste a raw encounter transcript or type freeform clinical observations into a text area.
- Click Generate Note → AI streams a structured SOAP note back in real time using server-sent events or WebSockets (no full-page reloads, no waiting for a complete response before rendering begins).
- Generated SOAP note must include: Subjective, Objective, Assessment with at least one suggested ICD-10 code and description semantically matched to the clinical content, and Plan.
- Provider can edit the generated note inline before saving.
- Save the finalized note to the database.

### Patient History and Context Injection
- When a provider starts an encounter for a patient who already has prior saved notes (matched by first name, last name, DOB), the AI must automatically retrieve and inject that patient's prior encounter history as context when generating the new SOAP note.
- The AI should reference relevant prior diagnoses or treatments where clinically appropriate.
- Retrieval must happen via a backend tool or function call during generation — NOT by stuffing prior notes into the frontend prompt.
- The AI should demonstrably behave differently for a returning patient versus a first-time patient.

### Note Versioning and Audit Trail
- Every time a provider edits and re-saves a note, a new version is written to the database.
- The prior version must never be overwritten or deleted.
- Providers can view the full version history of any note, including who saved each version and at what time.
- Version history must be stored in and retrieved from AWS RDS — not memory, not a flat file.

### ICD-10 Code Search
- Standalone ICD-10 search widget within the encounter workspace.
- Provider types a symptom or condition in plain English → top semantically relevant ICD-10 codes via vector similarity or an AI call.
- Clicking a result appends it to the Assessment section of the open note.
- Hard-code or embed a reasonably sized subset of ICD-10 codes (minimum 200–300 entries). No external ICD-10 API.

### Admin Dashboard
- View all encounters across all providers, filterable by provider and date range.
- Add and deactivate provider accounts.
- Manage a library of note templates (structured prompts shaping AI SOAP generation for different encounter types, e.g. orthopedic follow-up vs. new patient evaluation vs. urgent care visit). Admins can create, edit, delete templates.
- Providers select a template before generating; the AI must visibly behave differently depending on active template.
- Template changes take effect immediately: if a provider has the workspace open and the admin updates the template, the provider's next generation uses the new template without a page refresh.

### Session Persistence
- If a provider is mid-encounter (transcript entered, note not yet saved) and refreshes or closes/reopens the browser, the in-progress draft is restored from the database.
- Must work across devices: logging in from a different browser restores the same draft state.

### Non-Happy-Path Scenarios (at least two, demonstrated)
Examples given:
1. Transcript with no clinically meaningful content → AI responds gracefully, no hallucinated SOAP note.
2. Provider attempts to save a note while session expired → handle without data loss.
3. Admin deactivates a provider account while that provider has a draft open → define and implement reasonable behavior.

## Infrastructure Requirements
- Hosted on AWS EC2, accessible over HTTPS with a valid SSL certificate (no self-signed).
- All persistent data (encounters, note versions, patients, providers, templates, audit logs) in AWS RDS (PostgreSQL or MySQL). No SQLite, local files, or in-memory stores for anything that must survive restart.
- Normalized, defensible schema; be ready to walk through the ERD.
- Correct database connection pooling; no new DB connection per request.
- All environment secrets via AWS Secrets Manager or Parameter Store. No hardcoded credentials anywhere, including committed .env files.
- EC2 behind a reverse proxy (nginx); app process not directly exposed on 80/443.
- RDS not publicly accessible; connections only from within the VPC.

## Evaluation Criteria
- Correctness/reliability of core AI scribe workflow end to end.
- Streaming: progressive rendering, not spinner-then-dump.
- Database design: schema quality, normalization, indexing, defensibility.
- Infrastructure rigor: secrets management, VPC isolation of RDS, pooling, reverse proxy.
- UI quality: clinical tool aesthetics — clean, dense, high-trust; not consumer-app bubbly.
- Prioritization: build feels complete, not broken in obvious places.
- Non-happy-path handling.
- Code walkthrough quality: explain every architectural decision, AI model choice, prompt structure.

## Pioneer Features (stand-out extras; examples given)
- Provider-specific writing style learning from their history in the database.
- Automatic flagging of clinical red flags in the transcript before note generation.
- Diff view between note versions.
- Bulk export of all encounters for a patient as a single structured PDF.
