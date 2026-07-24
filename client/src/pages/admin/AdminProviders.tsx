// OWNED BY A8 — admin provider roster: add / deactivate / reactivate (PRD §7.3, §2.1 F7).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '@/api/client';
import { useAuth } from '@/auth/AuthContext';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Table } from '@/components/ui/Table';
import type { Column } from '@/components/ui/Table';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Banner } from '@/components/ui/Banner';
import { Spinner } from '@/components/ui/Spinner';
import { useToast } from '@/components/ui/Toast';
import { AddProviderModal } from '@/components/admin/AddProviderModal';
import { ConfirmDialog } from '@/components/admin/ConfirmDialog';
import { PendingApplications } from '@/components/admin/PendingApplications';
import { apiPatch } from '@/components/admin/adminApi';
import type {
  AdminProviderRow,
  AdminProvidersResponse,
  AdminProviderMutationResponse,
} from '@/components/admin/adminTypes';
import { formatDate, withCredentials } from '@/components/admin/format';

export function AdminProviders() {
  const { user } = useAuth();
  const toast = useToast();
  const [providers, setProviders] = useState<AdminProviderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [target, setTarget] = useState<AdminProviderRow | null>(null);
  const [rejectTarget, setRejectTarget] = useState<AdminProviderRow | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    return api
      .get<AdminProvidersResponse>('/admin/providers')
      .then((res) => setProviders(res.providers))
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : 'Could not load the roster.');
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const isAdminRow = useCallback(
    (r: AdminProviderRow) => r.role === 'admin' || r.id === user?.id,
    [user?.id],
  );

  const setActive = useCallback(
    async (row: AdminProviderRow, isActive: boolean) => {
      setBusyId(row.id);
      try {
        const res = await apiPatch<AdminProviderMutationResponse>(
          `/admin/providers/${row.id}`,
          { isActive },
        );
        setProviders((prev) => prev.map((p) => (p.id === row.id ? res.provider : p)));
        toast.success(
          isActive
            ? `${row.fullName} reactivated.`
            : `${row.fullName} deactivated.`,
        );
      } catch (err) {
        toast.error(err instanceof ApiError ? err.message : 'Update failed.');
      } finally {
        setBusyId(null);
        setTarget(null);
      }
    },
    [toast],
  );

  const decide = useCallback(
    async (row: AdminProviderRow, approvalStatus: 'approved' | 'rejected') => {
      setBusyId(row.id);
      try {
        const res = await apiPatch<AdminProviderMutationResponse>(
          `/admin/providers/${row.id}`,
          { approvalStatus },
        );
        setProviders((prev) => prev.map((p) => (p.id === row.id ? res.provider : p)));
        toast.success(
          approvalStatus === 'approved'
            ? `${row.fullName} approved.`
            : `${row.fullName}'s application was rejected.`,
        );
      } catch (err) {
        toast.error(err instanceof ApiError ? err.message : 'Update failed.');
      } finally {
        setBusyId(null);
        setRejectTarget(null);
      }
    },
    [toast],
  );

  // Applications awaiting review float above the roster; everything else (approved
  // or rejected) stays in the main table. Seeded rows without approvalStatus are
  // treated as established roster members.
  const pending = useMemo(
    () => providers.filter((p) => p.approvalStatus === 'pending'),
    [providers],
  );
  const roster = useMemo(
    () => providers.filter((p) => p.approvalStatus !== 'pending'),
    [providers],
  );

  const columns = useMemo<Column<AdminProviderRow>[]>(
    () => [
      {
        key: 'name',
        header: 'Name',
        render: (r) => (
          <div className="flex items-center gap-2">
            <span className="font-medium text-ink">{withCredentials(r.fullName, r.credentials)}</span>
            {isAdminRow(r) && (
              <Badge tone="neutral" title="Administrator account">
                Admin
              </Badge>
            )}
          </div>
        ),
      },
      {
        key: 'email',
        header: 'Email',
        render: (r) => <span className="text-muted">{r.email}</span>,
      },
      {
        key: 'status',
        header: 'Status',
        width: '130px',
        render: (r) =>
          r.approvalStatus === 'rejected' ? (
            <Badge tone="neutral" title="Application was rejected">
              Rejected
            </Badge>
          ) : r.isActive ? (
            <Badge tone="success" dot>
              Active
            </Badge>
          ) : (
            <Badge tone="critical" dot>
              Deactivated
            </Badge>
          ),
      },
      {
        key: 'encounters',
        header: 'Encounters',
        align: 'right',
        width: '110px',
        render: (r) => <span className="tabular-nums text-muted">{r.encounterCount}</span>,
      },
      {
        key: 'added',
        header: 'Added',
        width: '120px',
        render: (r) => <span className="tabular-nums text-muted">{formatDate(r.createdAt)}</span>,
      },
      {
        key: 'actions',
        header: '',
        align: 'right',
        width: '120px',
        render: (r) => {
          if (isAdminRow(r) || r.approvalStatus === 'rejected') return null;
          return r.isActive ? (
            <Button
              variant="danger"
              size="sm"
              loading={busyId === r.id}
              onClick={() => setTarget(r)}
            >
              Deactivate
            </Button>
          ) : (
            <Button
              variant="secondary"
              size="sm"
              loading={busyId === r.id}
              onClick={() => setActive(r, true)}
            >
              Reactivate
            </Button>
          );
        },
      },
    ],
    [isAdminRow, busyId, setActive],
  );

  return (
    <div>
      <PageHeader
        title="Providers"
        description="Manage the provider roster and account status."
        actions={<Button onClick={() => setAddOpen(true)}>Add provider</Button>}
      />

      {error && (
        <Banner tone="critical" className="mb-3" title="Unable to load roster">
          {error}
        </Banner>
      )}

      <PendingApplications
        rows={pending}
        busyId={busyId}
        onApprove={(r) => decide(r, 'approved')}
        onReject={(r) => setRejectTarget(r)}
      />

      <Card flush>
        <Table
          columns={columns}
          rows={roster}
          rowKey={(r) => r.id}
          empty={
            loading ? (
              <div className="flex items-center justify-center gap-2 py-12 text-muted">
                <Spinner size={18} />
                <span className="text-meta">Loading roster…</span>
              </div>
            ) : (
              <div className="px-3 py-8 text-center text-meta text-muted">No providers yet.</div>
            )
          }
        />
      </Card>

      <AddProviderModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onCreated={(created) => {
          setProviders((prev) => [created, ...prev]);
        }}
      />

      <ConfirmDialog
        open={target != null}
        tone="danger"
        title={target ? `Deactivate ${target.fullName}?` : 'Deactivate provider?'}
        confirmLabel="Deactivate"
        loading={busyId === target?.id}
        onCancel={() => setTarget(null)}
        onConfirm={() => target && setActive(target, false)}
      >
        They will be signed out on their next request; any open draft is preserved.
      </ConfirmDialog>

      <ConfirmDialog
        open={rejectTarget != null}
        tone="danger"
        title={rejectTarget ? `Reject ${rejectTarget.fullName}?` : 'Reject application?'}
        confirmLabel="Reject application"
        loading={busyId === rejectTarget?.id}
        onCancel={() => setRejectTarget(null)}
        onConfirm={() => rejectTarget && decide(rejectTarget, 'rejected')}
      >
        Rejection is final — the applicant will not be granted access and this
        decision is recorded in the audit log. They would need to apply again.
      </ConfirmDialog>
    </div>
  );
}
