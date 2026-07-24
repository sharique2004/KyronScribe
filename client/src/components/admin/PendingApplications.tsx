// OWNED BY F1 — pending signup applications surfaced above the roster.
// Each application shows the applicant, requested date, an Approve (primary) and
// a Reject (ghost-danger) control. Rejection is confirmed upstream and is final.
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import type { AdminProviderRow } from './adminTypes';
import { formatDate, withCredentials } from './format';

interface PendingApplicationsProps {
  rows: AdminProviderRow[];
  busyId: string | null;
  onApprove: (row: AdminProviderRow) => void;
  onReject: (row: AdminProviderRow) => void;
}

export function PendingApplications({ rows, busyId, onApprove, onReject }: PendingApplicationsProps) {
  if (rows.length === 0) return null;

  return (
    <Card flush className="mb-4 overflow-hidden border-[#F4D9AE]">
      <div className="flex items-center gap-2 border-b border-line bg-[#FEF9F0] px-4 py-2.5">
        <h2 className="text-body font-semibold text-ink">Pending applications</h2>
        <Badge tone="warning">{rows.length}</Badge>
        <span className="ml-auto text-meta text-muted">Awaiting your review</span>
      </div>
      <ul className="divide-y divide-line">
        {rows.map((r) => {
          const busy = busyId === r.id;
          return (
            <li key={r.id} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium text-ink">
                    {withCredentials(r.fullName, r.credentials)}
                  </span>
                  <Badge tone="warning" dot>
                    Pending review
                  </Badge>
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-meta text-muted">
                  <span className="truncate">{r.email}</span>
                  <span aria-hidden>·</span>
                  <span className="tabular-nums">Requested {formatDate(r.createdAt)}</span>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-critical hover:bg-flag-bg hover:text-critical"
                  disabled={busy}
                  onClick={() => onReject(r)}
                >
                  Reject
                </Button>
                <Button size="sm" loading={busy} onClick={() => onApprove(r)}>
                  Approve
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
