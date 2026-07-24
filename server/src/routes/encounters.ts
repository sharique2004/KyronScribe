// Encounter + note-version routes (PRD §4, §5). OWNED BY A4.
// Ownership: providers see only their own encounters; admins may read any (no clinical edit).
import { Router, type Request, type Response, type NextFunction } from 'express';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { query, withTransaction } from '../db.js';
import { requireAuth, requireProvider } from '../middleware/auth.js';
import { ApiError } from '../middleware/errors.js';
import { audit } from '../services/audit.js';
import { maybeReflect } from '../services/lessons.js';
import type { AuthedRequest, IcdCodeRef, RedFlag } from '../types.js';

const router = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: string }).code === '23505'
  );
}

const icdCodeSchema = z.object({ code: z.string(), description: z.string() });
const redFlagSchema = z.object({
  severity: z.enum(['high', 'moderate']),
  text: z.string(),
});
const noteContentSchema = z.object({
  subjective: z.string().default(''),
  objective: z.string().default(''),
  assessment: z.string().default(''),
  plan: z.string().default(''),
  icdCodes: z.array(icdCodeSchema).default([]),
  redFlags: z.array(redFlagSchema).default([]),
});

const createEncounterSchema = z.object({
  patient: z.object({
    first: z.string().trim().min(1),
    last: z.string().trim().min(1),
    dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'dob must be YYYY-MM-DD'),
  }),
  /** When the provider explicitly linked an existing patient from the autocomplete. */
  patientId: z.string().uuid().optional(),
  /** Clinical date of the visit (documentation may happen later). Defaults to today. */
  occurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'occurredOn must be YYYY-MM-DD').optional(),
  templateId: z.string().uuid().nullable().optional().default(null),
  transcript: z.string().min(1),
  note: noteContentSchema,
});

// ---- row shapes ---------------------------------------------------------

interface EncounterListRow {
  id: string;
  created_at: Date;
  occurred_on: string;
  mrn: string;
  patient_id: string;
  first_name: string;
  last_name: string;
  dob: string;
  template_name: string | null;
  version_count: number;
  lv_version_no: number | null;
  lv_icd_codes: IcdCodeRef[] | null;
  lv_created_at: Date | null;
}

interface EncounterHeadRow {
  id: string;
  created_at: Date;
  occurred_on: string;
  mrn: string;
  transcript: string;
  template_id: string | null;
  provider_id: string;
  template_name: string | null;
  provider_uid: string;
  provider_name: string;
  provider_creds: string | null;
  patient_id: string;
  first_name: string;
  last_name: string;
  dob: string;
  note_id: string | null;
}

interface VersionRow {
  id: string;
  version_no: number;
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
  icd_codes: IcdCodeRef[];
  red_flags: RedFlag[];
  created_at: Date;
  cb_id: string;
  cb_name: string;
}

// GET /api/encounters — the caller's own encounters with a latest-version summary.
router.get('/', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = (req as AuthedRequest).user;
    const { rows } = await query<EncounterListRow>(
      `SELECT e.id, e.created_at, to_char(e.occurred_on,'YYYY-MM-DD') AS occurred_on,
              p.id AS patient_id, p.mrn, p.first_name, p.last_name, to_char(p.dob,'YYYY-MM-DD') AS dob,
              t.name AS template_name,
              (SELECT count(*)::int FROM note_versions nv WHERE nv.note_id = n.id) AS version_count,
              lv.version_no  AS lv_version_no,
              lv.icd_codes   AS lv_icd_codes,
              lv.created_at  AS lv_created_at
       FROM encounters e
       JOIN patients p ON p.id = e.patient_id
       LEFT JOIN templates t ON t.id = e.template_id
       LEFT JOIN notes n ON n.encounter_id = e.id
       LEFT JOIN LATERAL (
         SELECT nv.version_no, nv.icd_codes, nv.created_at
         FROM note_versions nv
         WHERE nv.note_id = n.id
         ORDER BY nv.version_no DESC
         LIMIT 1
       ) lv ON true
       WHERE e.provider_id = $1
       ORDER BY e.occurred_on DESC, e.created_at DESC`,
      [user.id],
    );

    const encounters = rows.map((r) => ({
      id: r.id,
      createdAt: r.created_at.toISOString(),
      occurredOn: r.occurred_on,
      patient: {
        id: r.patient_id,
        mrn: r.mrn,
        firstName: r.first_name,
        lastName: r.last_name,
        dob: r.dob,
      },
      templateName: r.template_name,
      versionCount: r.version_count,
      latestVersion:
        r.lv_version_no !== null
          ? {
              versionNo: r.lv_version_no,
              icdCodes: r.lv_icd_codes ?? [],
              createdAt: (r.lv_created_at as Date).toISOString(),
            }
          : null,
    }));

    res.json({ encounters });
  } catch (err) {
    next(err);
  }
});

// GET /api/encounters/:id — owner or admin. Invalid/missing uuid → 404; wrong owner → 403.
router.get('/:id', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = (req as AuthedRequest).user;
    const id = req.params.id ?? '';
    if (!UUID_RE.test(id)) {
      throw new ApiError(404, 'NOT_FOUND', 'Encounter not found');
    }

    const { rows } = await query<EncounterHeadRow>(
      `SELECT e.id, e.created_at, to_char(e.occurred_on,'YYYY-MM-DD') AS occurred_on,
              e.transcript, e.template_id, e.provider_id,
              t.name AS template_name,
              u.id AS provider_uid, u.full_name AS provider_name, u.credentials AS provider_creds,
              p.id AS patient_id, p.mrn, p.first_name, p.last_name, to_char(p.dob,'YYYY-MM-DD') AS dob,
              n.id AS note_id
       FROM encounters e
       JOIN users u ON u.id = e.provider_id
       JOIN patients p ON p.id = e.patient_id
       LEFT JOIN templates t ON t.id = e.template_id
       LEFT JOIN notes n ON n.encounter_id = e.id
       WHERE e.id = $1`,
      [id],
    );
    const head = rows[0];
    if (!head) throw new ApiError(404, 'NOT_FOUND', 'Encounter not found');
    if (user.role !== 'admin' && head.provider_id !== user.id) {
      throw new ApiError(403, 'FORBIDDEN', 'You do not have access to this encounter');
    }

    const versions = head.note_id
      ? (
          await query<VersionRow>(
            `SELECT nv.id, nv.version_no, nv.subjective, nv.objective, nv.assessment, nv.plan,
                    nv.icd_codes, nv.red_flags, nv.created_at,
                    u.id AS cb_id, u.full_name AS cb_name
             FROM note_versions nv
             JOIN users u ON u.id = nv.created_by
             WHERE nv.note_id = $1
             ORDER BY nv.version_no DESC`,
            [head.note_id],
          )
        ).rows
      : [];

    res.json({
      encounter: {
        id: head.id,
        createdAt: head.created_at.toISOString(),
        occurredOn: head.occurred_on,
        transcript: head.transcript,
        templateId: head.template_id,
        templateName: head.template_name,
        provider: {
          id: head.provider_uid,
          fullName: head.provider_name,
          credentials: head.provider_creds,
        },
        patient: {
          id: head.patient_id,
          mrn: head.mrn,
          firstName: head.first_name,
          lastName: head.last_name,
          dob: head.dob,
        },
        noteId: head.note_id,
        versions: versions.map((v) => ({
          id: v.id,
          versionNo: v.version_no,
          subjective: v.subjective,
          objective: v.objective,
          assessment: v.assessment,
          plan: v.plan,
          icdCodes: v.icd_codes ?? [],
          redFlags: v.red_flags ?? [],
          createdBy: { id: v.cb_id, fullName: v.cb_name },
          createdAt: v.created_at.toISOString(),
        })),
      },
    });
  } catch (err) {
    next(err);
  }
});

// Upsert a patient by identity triple inside a transaction. A SAVEPOINT lets us recover from a
// concurrent-insert unique violation without aborting the whole encounter transaction.
async function upsertPatient(
  client: PoolClient,
  first: string,
  last: string,
  dob: string,
): Promise<string> {
  const selectSql = `SELECT id FROM patients
                     WHERE lower(first_name) = lower($1)
                       AND lower(last_name)  = lower($2)
                       AND dob = $3::date`;
  const found = await client.query<{ id: string }>(selectSql, [first, last, dob]);
  if (found.rows[0]) return found.rows[0].id;

  await client.query('SAVEPOINT patient_ins');
  try {
    const inserted = await client.query<{ id: string }>(
      'INSERT INTO patients (first_name, last_name, dob) VALUES ($1, $2, $3::date) RETURNING id',
      [first, last, dob],
    );
    await client.query('RELEASE SAVEPOINT patient_ins');
    return inserted.rows[0]!.id;
  } catch (err) {
    await client.query('ROLLBACK TO SAVEPOINT patient_ins');
    if (isUniqueViolation(err)) {
      const retry = await client.query<{ id: string }>(selectSql, [first, last, dob]);
      if (retry.rows[0]) return retry.rows[0].id;
    }
    throw err;
  }
}

// POST /api/encounters — finalize a new encounter (TX: patient → encounter → note → v1 → drop draft).
router.post('/', requireAuth, requireProvider, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = (req as AuthedRequest).user;
    const body = createEncounterSchema.parse(req.body);
    const { note } = body;

    const result = await withTransaction(async (client) => {
      // Explicitly linked entity wins over the identity-triple upsert: the provider chose
      // this exact patient from the autocomplete, so notes attach to the correct chart even
      // when the typed name differs in casing or spelling.
      let patientId: string;
      if (body.patientId) {
        const linked = await client.query<{ id: string }>(
          'SELECT id FROM patients WHERE id = $1',
          [body.patientId],
        );
        if (!linked.rows[0]) {
          throw new ApiError(400, 'VALIDATION', 'The linked patient no longer exists.');
        }
        patientId = linked.rows[0].id;
      } else {
        patientId = await upsertPatient(
          client,
          body.patient.first,
          body.patient.last,
          body.patient.dob,
        );
      }

      const enc = await client.query<{ id: string }>(
        `INSERT INTO encounters (patient_id, provider_id, template_id, transcript, occurred_on)
         VALUES ($1, $2, $3, $4, COALESCE($5::date, CURRENT_DATE)) RETURNING id`,
        [patientId, user.id, body.templateId ?? null, body.transcript, body.occurredOn ?? null],
      );
      const encounterId = enc.rows[0]!.id;

      const noteRow = await client.query<{ id: string }>(
        'INSERT INTO notes (encounter_id) VALUES ($1) RETURNING id',
        [encounterId],
      );
      const noteId = noteRow.rows[0]!.id;

      await client.query(
        `INSERT INTO note_versions
           (note_id, version_no, subjective, objective, assessment, plan, icd_codes, red_flags, created_by)
         VALUES ($1, 1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8)`,
        [
          noteId,
          note.subjective,
          note.objective,
          note.assessment,
          note.plan,
          JSON.stringify(note.icdCodes),
          JSON.stringify(note.redFlags),
          user.id,
        ],
      );

      await client.query('DELETE FROM drafts WHERE provider_id = $1', [user.id]);

      return { encounterId, noteId };
    });

    audit(user.id, 'note.save', 'encounter', result.encounterId, { versionNo: 1 });
    res.status(201).json({ ...result, versionNo: 1 });

    // Self-improving loop: after the save commits, check (async, never blocking the
    // response) whether this encounter revises the patient's prior diagnosis; if so,
    // reflect on both encounters and store a retrievable clinical lesson.
    setImmediate(() => {
      void maybeReflect(result.encounterId).catch((err) =>
        console.warn('[lessons] reflection skipped:', err),
      );
    });
  } catch (err) {
    next(err);
  }
});

const versionSchema = noteContentSchema;

// POST /api/encounters/:id/versions — append the next version. Owner (provider) only.
router.post(
  '/:id/versions',
  requireAuth,
  requireProvider,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = (req as AuthedRequest).user;
      const id = req.params.id ?? '';
      if (!UUID_RE.test(id)) throw new ApiError(404, 'NOT_FOUND', 'Encounter not found');

      const content = versionSchema.parse(req.body);

      const { rows } = await query<{ provider_id: string; note_id: string | null }>(
        `SELECT e.provider_id, n.id AS note_id
         FROM encounters e
         LEFT JOIN notes n ON n.encounter_id = e.id
         WHERE e.id = $1`,
        [id],
      );
      const head = rows[0];
      if (!head || !head.note_id) throw new ApiError(404, 'NOT_FOUND', 'Encounter not found');
      if (head.provider_id !== user.id) {
        throw new ApiError(403, 'FORBIDDEN', 'You do not have access to this encounter');
      }
      const noteId = head.note_id;

      // Append max+1, retrying once if a concurrent save grabbed the same version number.
      let versionNo = 0;
      for (let attempt = 0; attempt < 2; attempt++) {
        const next = await query<{ next: number }>(
          'SELECT COALESCE(MAX(version_no), 0) + 1 AS next FROM note_versions WHERE note_id = $1',
          [noteId],
        );
        versionNo = next.rows[0]!.next;
        try {
          await query(
            `INSERT INTO note_versions
               (note_id, version_no, subjective, objective, assessment, plan, icd_codes, red_flags, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9)`,
            [
              noteId,
              versionNo,
              content.subjective,
              content.objective,
              content.assessment,
              content.plan,
              JSON.stringify(content.icdCodes),
              JSON.stringify(content.redFlags),
              user.id,
            ],
          );
          break;
        } catch (err) {
          if (isUniqueViolation(err) && attempt === 0) continue;
          throw err;
        }
      }

      audit(user.id, 'note.save', 'encounter', id, { versionNo });
      res.status(201).json({ versionNo });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
