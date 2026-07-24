// OWNED BY A7 — provider "My Encounters" list (PRD §7.3). Dense table linking
// through to the note detail + version history.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/api/client';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Table } from '@/components/ui/Table';
import type { Column } from '@/components/ui/Table';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Spinner } from '@/components/ui/Spinner';
import { Banner } from '@/components/ui/Banner';
import { formatDate, formatDob } from '@/components/workspace/format';
import type { WireEncounterListItem } from '@/components/workspace/wireTypes';

export function EncounterList() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<WireEncounterListItem[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .get<{ encounters: WireEncounterListItem[] }>('/encounters')
      .then((res) => {
        if (!cancelled) setRows(res.encounters);
      })
      .catch(() => {
        if (!cancelled) {
          setError(true);
          setRows([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const columns: Array<Column<WireEncounterListItem>> = [
    {
      key: 'date',
      header: 'Date',
      width: '128px',
      className: 'tabular-nums text-muted',
      render: (r) => formatDate(r.occurredOn ?? r.createdAt),
    },
    {
      key: 'patient',
      header: 'Patient',
      render: (r) => (
        <span className="font-medium text-ink">
          {r.patient.lastName}, {r.patient.firstName}
        </span>
      ),
    },
    {
      key: 'dob',
      header: 'DOB',
      width: '116px',
      className: 'tabular-nums text-muted',
      render: (r) => formatDob(r.patient.dob),
    },
    {
      key: 'template',
      header: 'Template',
      render: (r) => r.templateName ?? <span className="text-muted">—</span>,
    },
    {
      key: 'codes',
      header: 'Codes',
      render: (r) => {
        const codes = r.latestVersion?.icdCodes ?? [];
        if (codes.length === 0) return <span className="text-muted">—</span>;
        return (
          <div className="flex flex-wrap gap-1">
            {codes.slice(0, 4).map((c) => (
              <Badge key={c.code} tone="neutral" title={c.description}>
                {c.code}
              </Badge>
            ))}
            {codes.length > 4 && <Badge tone="neutral">+{codes.length - 4}</Badge>}
          </div>
        );
      },
    },
    {
      key: 'versions',
      header: 'Versions',
      align: 'right',
      width: '84px',
      className: 'tabular-nums text-muted',
      render: (r) => r.versionCount,
    },
  ];

  return (
    <div>
      <PageHeader
        title="My Encounters"
        description="Your saved encounters, most recent first."
        actions={
          <Button size="sm" onClick={() => navigate('/')}>
            New encounter
          </Button>
        }
      />

      {error && (
        <div className="mb-3">
          <Banner tone="critical">Could not load your encounters. Refresh to try again.</Banner>
        </div>
      )}

      <Card flush>
        {rows === null ? (
          <div className="flex items-center justify-center py-16 text-muted">
            <Spinner size={20} />
          </div>
        ) : (
          <Table
            columns={columns}
            rows={rows}
            rowKey={(r) => r.id}
            onRowClick={(r) => navigate(`/encounters/${r.id}`)}
            empty={
              <EmptyState
                title="No encounters yet"
                hint="Generate and save your first note from the New Encounter workspace."
                action={
                  <Button size="sm" onClick={() => navigate('/')}>
                    New encounter
                  </Button>
                }
              />
            }
          />
        )}
      </Card>
    </div>
  );
}
