// OWNED BY A7 — provider encounter detail (PRD §7.3): clean clinical read view,
// inline edit → save-as-new-version, version rail, word-level diff (P2), and a
// self-contained print export (P4). The print CSS lives here (not in the shared
// styles.css): the interactive content carries `kyron-print-hide`, and a
// dedicated `kyron-print-only` container renders the clean document for print.
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError } from '@/api/client';
import { useAuth } from '@/auth/AuthContext';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import { Banner } from '@/components/ui/Banner';
import { Spinner } from '@/components/ui/Spinner';
import { SectionLabel } from '@/components/ui/SectionLabel';
import { Textarea } from '@/components/ui/Textarea';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/components/ui/cn';
import { CodeChips } from '@/components/workspace/CodeChips';
import { IcdSearch } from '@/components/workspace/IcdSearch';
import { SectionDiff } from '@/components/workspace/SectionDiff';
import { RedFlagChips } from '@/components/workspace/RedFlagChips';
import { LessonsPanel } from '@/components/workspace/LessonsPanel';
import { formatDate, formatDateTime, formatDob } from '@/components/workspace/format';
import type { WireEncounterDetail, WireNoteVersion } from '@/components/workspace/wireTypes';
import type { IcdCode } from '@/types';

const PRINT_CSS = `
.kyron-print-only { display: none; }
@media print {
  .kyron-print-hide { display: none !important; }
  .kyron-print-only { display: block !important; }
  @page { margin: 18mm; }
}
`;

interface EditState {
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
  icdCodes: IcdCode[];
}

type Mode = 'view' | 'edit' | 'diff';

const SOAP_FIELDS: Array<{ key: keyof EditState & ('subjective' | 'objective' | 'assessment' | 'plan'); label: string }> = [
  { key: 'subjective', label: 'Subjective' },
  { key: 'objective', label: 'Objective' },
  { key: 'assessment', label: 'Assessment' },
  { key: 'plan', label: 'Plan' },
];

export function EncounterDetail() {
  const { id } = useParams<{ id: string }>();
  const { runWithAuthRetry } = useAuth();
  const toast = useToast();

  const [data, setData] = useState<WireEncounterDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('view');
  const [selectedNo, setSelectedNo] = useState<number | null>(null);
  const [edit, setEdit] = useState<EditState | null>(null);
  const [saving, setSaving] = useState(false);
  const [diffBase, setDiffBase] = useState<number | null>(null);
  const [diffCompare, setDiffCompare] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const res = await api.get<{ encounter: WireEncounterDetail }>(`/encounters/${id}`);
      setData(res.encounter);
      setError(null);
      return res.encounter;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load this encounter.');
      return null;
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const versions = data?.versions ?? [];
  const latest = versions[0] ?? null;

  // Default the selected/diff versions once data lands.
  useEffect(() => {
    if (!latest) return;
    setSelectedNo((prev) => (prev == null ? latest.versionNo : prev));
    if (versions.length >= 2) {
      const newer = versions[0]!.versionNo;
      const older = versions[1]!.versionNo;
      setDiffCompare((prev) => (prev == null ? newer : prev));
      setDiffBase((prev) => (prev == null ? older : prev));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latest?.versionNo, versions.length]);

  const versionByNo = useCallback(
    (no: number | null): WireNoteVersion | null => versions.find((v) => v.versionNo === no) ?? null,
    [versions],
  );

  const viewed = versionByNo(selectedNo) ?? latest;

  const startEdit = useCallback(() => {
    if (!latest) return;
    setEdit({
      subjective: latest.subjective,
      objective: latest.objective,
      assessment: latest.assessment,
      plan: latest.plan,
      icdCodes: latest.icdCodes,
    });
    setSelectedNo(latest.versionNo);
    setMode('edit');
  }, [latest]);

  const addCode = useCallback(
    (code: IcdCode) => {
      setEdit((prev) => {
        if (!prev) return prev;
        if (prev.icdCodes.some((c) => c.code === code.code)) {
          toast.toast(`${code.code} is already in the assessment`, { tone: 'warning' });
          return prev;
        }
        toast.success(`Added ${code.code}`);
        return { ...prev, icdCodes: [...prev.icdCodes, code] };
      });
    },
    [toast],
  );

  const removeCode = useCallback((code: string) => {
    setEdit((prev) => (prev ? { ...prev, icdCodes: prev.icdCodes.filter((c) => c.code !== code) } : prev));
  }, []);

  const saveNewVersion = useCallback(async () => {
    if (!edit || !latest || !id) return;
    setSaving(true);
    try {
      const res = await runWithAuthRetry(() =>
        api.post<{ versionNo: number }>(`/encounters/${id}/versions`, {
          subjective: edit.subjective,
          objective: edit.objective,
          assessment: edit.assessment,
          plan: edit.plan,
          icdCodes: edit.icdCodes,
          redFlags: latest.redFlags,
        }),
      );
      const fresh = await load();
      setMode('view');
      setEdit(null);
      setSelectedNo(res.versionNo);
      if (fresh && fresh.versions.length >= 2) {
        setDiffCompare(res.versionNo);
        setDiffBase(fresh.versions[1]!.versionNo);
      }
      toast.success(`Saved as v${res.versionNo}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not save the new version.');
    } finally {
      setSaving(false);
    }
  }, [edit, latest, id, runWithAuthRetry, load, toast]);

  // --- Loading / error gates. ---
  if (error) {
    return (
      <div>
        <PageHeader title="Encounter" actions={<BackButton />} />
        <Banner tone="critical">{error}</Banner>
      </div>
    );
  }
  if (!data || !viewed || !latest) {
    return (
      <div>
        <PageHeader title="Encounter" actions={<BackButton />} />
        <Card>
          <div className="flex items-center justify-center py-16 text-muted">
            <Spinner size={20} />
          </div>
        </Card>
      </div>
    );
  }

  const p = data.patient;
  const patientName = `${p.lastName}, ${p.firstName}`;
  const providerLabel = data.provider.credentials
    ? `${data.provider.fullName}, ${data.provider.credentials}`
    : data.provider.fullName;
  const isLatestSelected = viewed.versionNo === latest.versionNo;
  const diffFrom = versionByNo(diffBase);
  const diffTo = versionByNo(diffCompare);

  return (
    <div>
      <style>{PRINT_CSS}</style>

      {/* ---- Interactive content (hidden when printing) ---- */}
      <div className="kyron-print-hide">
        <PageHeader
          title={patientName}
          description={
            <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span className="tabular-nums">DOB {formatDob(p.dob)}</span>
              <span className="text-line">|</span>
              <span>{providerLabel}</span>
              <span className="text-line">|</span>
              <span className="tabular-nums">{formatDate(data.createdAt)}</span>
              {data.templateName && (
                <>
                  <span className="text-line">|</span>
                  <span>{data.templateName}</span>
                </>
              )}
            </span>
          }
          actions={
            <div className="flex items-center gap-2">
              {mode !== 'edit' && (
                <Button variant="secondary" size="sm" onClick={() => window.print()}>
                  Print
                </Button>
              )}
              {versions.length >= 2 && mode !== 'edit' && (
                <Button
                  variant={mode === 'diff' ? 'primary' : 'secondary'}
                  size="sm"
                  onClick={() => setMode(mode === 'diff' ? 'view' : 'diff')}
                >
                  {mode === 'diff' ? 'Close compare' : 'Compare'}
                </Button>
              )}
              {mode === 'view' && (
                <Button size="sm" onClick={startEdit}>
                  Edit
                </Button>
              )}
              <BackButton />
            </div>
          }
        />

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_240px]">
          {/* Main column */}
          <div className="space-y-4">
            {mode === 'diff' ? (
              <Card
                flush
                title="Compare versions"
                actions={
                  <div className="flex items-center gap-2">
                    <Select
                      value={String(diffBase ?? '')}
                      onChange={(e) => setDiffBase(Number(e.target.value))}
                      className="h-7 text-meta"
                    >
                      {versions.map((v) => (
                        <option key={v.id} value={v.versionNo}>
                          v{v.versionNo}
                        </option>
                      ))}
                    </Select>
                    <span className="text-meta text-muted">→</span>
                    <Select
                      value={String(diffCompare ?? '')}
                      onChange={(e) => setDiffCompare(Number(e.target.value))}
                      className="h-7 text-meta"
                    >
                      {versions.map((v) => (
                        <option key={v.id} value={v.versionNo}>
                          v{v.versionNo}
                        </option>
                      ))}
                    </Select>
                  </div>
                }
              >
                {diffFrom && diffTo ? (
                  <>
                    <div className="border-b border-line px-4 py-2 text-meta text-muted">
                      <span className="inline-flex items-center gap-1">
                        <span className="inline-block h-2 w-2 rounded-sm bg-[#DCFCE7]" /> additions in v
                        {diffTo.versionNo}
                      </span>
                      <span className="mx-2">·</span>
                      <span className="inline-flex items-center gap-1">
                        <span className="inline-block h-2 w-2 rounded-sm bg-[#FEE2E2]" /> removed from v
                        {diffFrom.versionNo}
                      </span>
                    </div>
                    {SOAP_FIELDS.map((f) => (
                      <SectionDiff
                        key={f.key}
                        label={f.label}
                        before={diffFrom[f.key]}
                        after={diffTo[f.key]}
                      />
                    ))}
                  </>
                ) : (
                  <div className="px-4 py-6 text-center text-meta text-muted">
                    Select two versions to compare.
                  </div>
                )}
              </Card>
            ) : mode === 'edit' && edit ? (
              <Card flush title={`Editing — new version will be v${latest.versionNo + 1}`}>
                {SOAP_FIELDS.map((f) => (
                  <section key={f.key} className="border-b border-line px-4 py-3">
                    <SectionLabel className="mb-1.5">{f.label}</SectionLabel>
                    <Textarea
                      autosize
                      rows={1}
                      value={edit[f.key]}
                      onChange={(e) => setEdit((prev) => (prev ? { ...prev, [f.key]: e.target.value } : prev))}
                      className="border-line px-2 py-1.5"
                    />
                    {f.key === 'assessment' && (
                      <div className="mt-3 space-y-2">
                        <SectionLabel>ICD-10 codes</SectionLabel>
                        <CodeChips
                          codes={edit.icdCodes}
                          onRemove={removeCode}
                          emptyHint="No codes — add them below."
                        />
                        <IcdSearch enabled onPick={addCode} />
                      </div>
                    )}
                  </section>
                ))}
                <div className="flex items-center justify-end gap-2 px-4 py-3">
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setMode('view');
                      setEdit(null);
                    }}
                    disabled={saving}
                  >
                    Cancel
                  </Button>
                  <Button onClick={saveNewVersion} loading={saving}>
                    Save as new version
                  </Button>
                </div>
              </Card>
            ) : (
              <>
                {!isLatestSelected && (
                  <Banner tone="info">
                    Viewing v{viewed.versionNo} of {versions.length}. This is a historical version —
                    edits always branch from the latest (v{latest.versionNo}).
                  </Banner>
                )}
                <Card flush>
                  <ReadNote version={viewed} />
                </Card>
              </>
            )}

            {/* Self-improving loop: diagnostic-revision lessons for this patient (omitted when none). */}
            <LessonsPanel patientId={p.id} />
          </div>

          {/* Version rail */}
          <div>
            <Card flush title="Versions">
              <ul className="max-h-[70vh] overflow-y-auto">
                {versions.map((v) => {
                  const active = v.versionNo === viewed.versionNo && mode !== 'diff';
                  return (
                    <li key={v.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setMode('view');
                          setSelectedNo(v.versionNo);
                        }}
                        className={cn(
                          'flex w-full flex-col gap-0.5 border-b border-line px-3 py-2 text-left last:border-0',
                          active ? 'bg-[#EAF0FC]' : 'hover:bg-page',
                        )}
                      >
                        <span className="flex items-center gap-1.5">
                          <span className={cn('text-body font-semibold', active ? 'text-primary' : 'text-ink')}>
                            v{v.versionNo}
                          </span>
                          {v.versionNo === latest.versionNo && (
                            <Badge tone="success">latest</Badge>
                          )}
                        </span>
                        <span className="text-meta text-muted">{v.createdBy.fullName}</span>
                        <span className="tabular-nums text-meta text-muted">
                          {formatDateTime(v.createdAt)}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </Card>
          </div>
        </div>
      </div>

      {/* ---- Print-only clean clinical document ---- */}
      <div className="kyron-print-only">
        <PrintDocument
          patientName={patientName}
          dob={formatDob(p.dob)}
          provider={providerLabel}
          date={formatDate(data.createdAt)}
          templateName={data.templateName}
          version={viewed}
        />
      </div>
    </div>
  );
}

function BackButton() {
  return (
    <Link to="/encounters">
      <Button variant="secondary" size="sm">
        Back to list
      </Button>
    </Link>
  );
}

/** Clean read rendering of one version: red flags, S/O/A/P, ICD chips. */
function ReadNote({ version }: { version: WireNoteVersion }) {
  return (
    <div>
      {version.redFlags.length > 0 && (
        <div className="px-4 pt-4">
          <RedFlagChips flags={version.redFlags} />
        </div>
      )}
      {SOAP_FIELDS.map((f) => (
        <section key={f.key} className="border-b border-line px-4 py-3 last:border-0">
          <SectionLabel className="mb-1.5">{f.label}</SectionLabel>
          <p className="whitespace-pre-wrap text-body text-ink">
            {version[f.key] ? version[f.key] : <span className="text-muted/60">—</span>}
          </p>
          {f.key === 'assessment' && version.icdCodes.length > 0 && (
            <div className="mt-2.5 space-y-1.5">
              <SectionLabel>ICD-10 codes</SectionLabel>
              <CodeChips codes={version.icdCodes} />
            </div>
          )}
        </section>
      ))}
    </div>
  );
}

/** Minimal, self-contained clinical document for print/PDF (P4). */
function PrintDocument(props: {
  patientName: string;
  dob: string;
  provider: string;
  date: string;
  templateName: string | null;
  version: WireNoteVersion;
}) {
  const { patientName, dob, provider, date, templateName, version } = props;
  return (
    <div style={{ color: '#0F172A', fontSize: '12px', lineHeight: 1.5 }}>
      <div style={{ borderBottom: '2px solid #0F172A', paddingBottom: 8, marginBottom: 12 }}>
        <div style={{ fontSize: '16px', fontWeight: 700 }}>{patientName}</div>
        <div style={{ color: '#5B6472', marginTop: 2 }}>
          DOB {dob} &nbsp;·&nbsp; {provider} &nbsp;·&nbsp; {date}
          {templateName ? ` · ${templateName}` : ''} &nbsp;·&nbsp; v{version.versionNo}
        </div>
      </div>
      {SOAP_FIELDS.map((f) => (
        <div key={f.key} style={{ marginBottom: 12 }}>
          <div
            style={{
              fontSize: '10px',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              color: '#5B6472',
              marginBottom: 3,
            }}
          >
            {f.label}
          </div>
          <div style={{ whiteSpace: 'pre-wrap' }}>{version[f.key] || '—'}</div>
          {f.key === 'assessment' && version.icdCodes.length > 0 && (
            <div style={{ marginTop: 6 }}>
              {version.icdCodes.map((c) => (
                <span key={c.code} style={{ marginRight: 12 }}>
                  <strong style={{ fontFamily: 'monospace' }}>{c.code}</strong> {c.description}
                </span>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
