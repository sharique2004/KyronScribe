// OWNED BY A8 — admin encounters dashboard with provider + date filters (PRD §7.3).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '@/api/client';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Table } from '@/components/ui/Table';
import type { Column } from '@/components/ui/Table';
import { Select } from '@/components/ui/Select';
import { DateInput } from '@/components/ui/DateInput';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Banner } from '@/components/ui/Banner';
import { Spinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { NoteViewModal } from '@/components/admin/NoteViewModal';
import type {
  AdminEncounterRow,
  AdminEncountersResponse,
  AdminProviderRow,
  AdminProvidersResponse,
} from '@/components/admin/adminTypes';
import { formatDate, formatDob } from '@/components/admin/format';

interface Filters {
  providerId: string;
  from: string;
  to: string;
}

const EMPTY_FILTERS: Filters = { providerId: '', from: '', to: '' };

export function AdminEncounters() {
  const [providers, setProviders] = useState<AdminProviderRow[]>([]);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [rows, setRows] = useState<AdminEncounterRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  // Provider roster powers the filter Select.
  useEffect(() => {
    let cancelled = false;
    api
      .get<AdminProvidersResponse>('/admin/providers')
      .then((res) => {
        if (!cancelled) setProviders(res.providers);
      })
      .catch(() => {
        /* filter Select just stays empty; encounters still load */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const load = useCallback((f: Filters) => {
    const params = new URLSearchParams();
    if (f.providerId) params.set('providerId', f.providerId);
    if (f.from) params.set('from', f.from);
    if (f.to) params.set('to', f.to);
    const qs = params.toString();
    setLoading(true);
    setError(null);
    return api
      .get<AdminEncountersResponse>(`/admin/encounters${qs ? `?${qs}` : ''}`)
      .then((res) => setRows(res.encounters))
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : 'Could not load encounters.');
        setRows([]);
      })
      .finally(() => setLoading(false));
  }, []);

  // Refetch whenever a filter changes (provider AND date range compose).
  useEffect(() => {
    load(filters);
  }, [filters, load]);

  const hasFilters = filters.providerId !== '' || filters.from !== '' || filters.to !== '';

  const columns = useMemo<Column<AdminEncounterRow>[]>(
    () => [
      {
        key: 'date',
        header: 'Date',
        width: '120px',
        render: (r) => <span className="tabular-nums text-muted">{formatDate(r.createdAt)}</span>,
      },
      {
        key: 'provider',
        header: 'Provider',
        render: (r) => <span className="text-ink">{r.provider.fullName}</span>,
      },
      {
        key: 'patient',
        header: 'Patient',
        render: (r) => (
          <span className="font-medium text-ink">
            {r.patient.firstName} {r.patient.lastName}
          </span>
        ),
      },
      {
        key: 'dob',
        header: 'DOB',
        width: '120px',
        render: (r) => <span className="tabular-nums text-muted">{formatDob(r.patient.dob)}</span>,
      },
      {
        key: 'template',
        header: 'Template',
        render: (r) => <span className="text-muted">{r.templateName ?? '—'}</span>,
      },
      {
        key: 'codes',
        header: 'Codes',
        render: (r) => {
          const codes = r.latestVersion?.icdCodes ?? [];
          if (codes.length === 0) return <span className="text-muted">—</span>;
          const shown = codes.slice(0, 3);
          return (
            <div className="flex flex-wrap items-center gap-1">
              {shown.map((c) => (
                <Badge key={c.code} tone="neutral" title={c.description}>
                  <span className="tabular-nums">{c.code}</span>
                </Badge>
              ))}
              {codes.length > shown.length && (
                <span className="text-meta text-muted">+{codes.length - shown.length}</span>
              )}
            </div>
          );
        },
      },
      {
        key: 'versions',
        header: 'Versions',
        align: 'right',
        width: '90px',
        render: (r) => <span className="tabular-nums text-muted">{r.versionCount}</span>,
      },
    ],
    [],
  );

  return (
    <div>
      <PageHeader
        title="Encounters"
        description="All encounters across the practice, filterable by provider and date range."
      />

      {/* Filter bar */}
      <Card className="mb-3" bodyClassName="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-section uppercase tracking-wide text-muted">Provider</span>
          <Select
            className="w-56"
            value={filters.providerId}
            onChange={(e) => setFilters((f) => ({ ...f, providerId: e.target.value }))}
          >
            <option value="">All providers</option>
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.fullName}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-section uppercase tracking-wide text-muted">From</span>
          <DateInput
            className="w-40"
            value={filters.from}
            max={filters.to || undefined}
            onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-section uppercase tracking-wide text-muted">To</span>
          <DateInput
            className="w-40"
            value={filters.to}
            min={filters.from || undefined}
            onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))}
          />
        </label>
        <Button
          variant="ghost"
          onClick={() => setFilters(EMPTY_FILTERS)}
          disabled={!hasFilters}
        >
          Clear
        </Button>
        <div className="ml-auto flex items-center gap-2 text-meta text-muted">
          {loading ? (
            <Spinner size={14} />
          ) : (
            <span className="tabular-nums">
              {rows.length} encounter{rows.length === 1 ? '' : 's'}
            </span>
          )}
        </div>
      </Card>

      {error && (
        <Banner tone="critical" className="mb-3" title="Unable to load encounters">
          {error}
        </Banner>
      )}

      <Card flush>
        <Table
          columns={columns}
          rows={rows}
          rowKey={(r) => r.id}
          onRowClick={(r) => setOpenId(r.id)}
          empty={
            loading ? (
              <div className="flex items-center justify-center gap-2 py-12 text-muted">
                <Spinner size={18} />
                <span className="text-meta">Loading encounters…</span>
              </div>
            ) : (
              <EmptyState
                title={hasFilters ? 'No encounters match these filters' : 'No encounters yet'}
                hint={
                  hasFilters
                    ? 'Try widening the date range or choosing a different provider.'
                    : 'Encounters saved by providers will appear here.'
                }
                action={
                  hasFilters ? (
                    <Button variant="secondary" size="sm" onClick={() => setFilters(EMPTY_FILTERS)}>
                      Clear filters
                    </Button>
                  ) : undefined
                }
              />
            )
          }
        />
      </Card>

      <NoteViewModal encounterId={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}
