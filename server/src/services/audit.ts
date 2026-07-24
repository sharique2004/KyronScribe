// Fire-and-forget audit logging (PRD §9). Failures are swallowed + logged so an audit
// write can never break the request path the user is on.
import { query } from '../db.js';

export function audit(
  userId: string | null,
  action: string,
  entityType?: string | null,
  entityId?: string | null,
  meta: Record<string, unknown> = {},
): void {
  query(
    'INSERT INTO audit_log (user_id, action, entity_type, entity_id, meta) VALUES ($1, $2, $3, $4, $5)',
    [userId, action, entityType ?? null, entityId ?? null, JSON.stringify(meta)],
  ).catch((err: unknown) => {
    console.error(`[audit] failed to record "${action}"`, err);
  });
}
