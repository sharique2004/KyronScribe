// OWNED BY A8 — read-only clinical note viewer for admins (PRD §7.3).
// Opens over a selected encounter; admins are authorized on GET /encounters/:id.
// No editing controls — admins never clinically edit others' notes.
import { useEffect, useState } from 'react';
import { api, ApiError } from '@/api/client';
import { Modal } from '@/components/ui/Modal';
import { Badge } from '@/components/ui/Badge';
import { Banner } from '@/components/ui/Banner';
import { Select } from '@/components/ui/Select';
import { Spinner } from '@/components/ui/Spinner';
import { SectionLabel } from '@/components/ui/SectionLabel';
import type { RedFlag } from '@/types';
import type {
  AdminEncounterDetail,
  AdminEncounterDetailResponse,
  AdminNoteVersion,
} from './adminTypes';
import { formatDateTime, formatDob, withCredentials } from './format';

interface NoteViewModalProps {
  encounterId: string | null;
  onClose: () => void;
}

const SOAP: Array<{ key: keyof AdminNoteVersion; label: string }> = [
  { key: 'subjective', label: 'Subjective' },
  { key: 'objective', label: 'Objective' },
  { key: 'assessment', label: 'Assessment' },
  { key: 'plan', label: 'Plan' },
];

function flagTone(severity: RedFlag['severity']) {
  return severity === 'high' ? 'critical' : 'warning';
}

export function NoteViewModal({ encounterId, onClose }: NoteViewModalProps) {
  const [detail, setDetail] = useState<AdminEncounterDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [versionId, setVersionId] = useState<string | null>(null);

  useEffect(() => {
    if (!encounterId) {
      setDetail(null);
      setError(null);
      setVersionId(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setDetail(null);
    api
      .get<AdminEncounterDetailResponse>(`/encounters/${encounterId}`)
      .then((res) => {
        if (cancelled) return;
        setDetail(res.encounter);
        setVersionId(res.encounter.versions[0]?.id ?? null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : 'Could not load this encounter.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [encounterId]);

  const version =
    detail?.versions.find((v) => v.id === versionId) ?? detail?.versions[0] ?? null;

  const patientName = detail
    ? `${detail.patient.firstName} ${detail.patient.lastName}`
    : '';

  return (
    <Modal
      open={encounterId != null}
      onClose={onClose}
      size="lg"
      title={detail ? patientName : 'Encounter note'}
      description={
        detail
          ? `DOB ${formatDob(detail.patient.dob)} · ${withCredentials(
              detail.provider.fullName,
              detail.provider.credentials,
            )} · ${formatDateTime(detail.createdAt)}`
          : undefined
      }
    >
      {loading && (
        <div className="flex items-center justify-center gap-2 py-10 text-muted">
          <Spinner size={18} />
          <span className="text-meta">Loading note…</span>
        </div>
      )}

      {error && !loading && (
        <Banner tone="critical" title="Unable to load">
          {error}
        </Banner>
      )}

      {detail && version && !loading && (
        <div className="flex flex-col gap-4">
          {/* Version + template meta */}
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="primary">v{version.versionNo}</Badge>
            <span className="text-meta text-muted">
              {withCredentials(version.createdBy.fullName, null)} · {formatDateTime(version.createdAt)}
            </span>
            <span className="text-meta text-muted">·</span>
            <span className="text-meta text-muted">
              Template: {detail.templateName ?? 'None'}
            </span>
            {detail.versions.length > 1 && (
              <div className="ml-auto flex items-center gap-1.5">
                <span className="text-section uppercase tracking-wide text-muted">Version</span>
                <Select
                  className="h-7 w-auto text-meta"
                  value={version.id}
                  onChange={(e) => setVersionId(e.target.value)}
                >
                  {detail.versions.map((v) => (
                    <option key={v.id} value={v.id}>
                      v{v.versionNo} · {formatDateTime(v.createdAt)}
                    </option>
                  ))}
                </Select>
              </div>
            )}
          </div>

          {/* Red flags */}
          {version.redFlags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {version.redFlags.map((f, i) => (
                <Badge key={i} tone={flagTone(f.severity)} dot>
                  {f.text}
                </Badge>
              ))}
            </div>
          )}

          {/* SOAP sections */}
          {SOAP.map(({ key, label }) => {
            const body = (version[key] as string) || '';
            return (
              <div key={key}>
                <SectionLabel className="mb-1">{label}</SectionLabel>
                <p className="whitespace-pre-wrap text-body text-ink">
                  {body.trim() || <span className="text-muted">Not documented.</span>}
                </p>
                {key === 'assessment' && version.icdCodes.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {version.icdCodes.map((c) => (
                      <Badge key={c.code} tone="neutral" title={c.description}>
                        <span className="font-semibold tabular-nums">{c.code}</span>
                        <span className="text-muted"> · {c.description}</span>
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {/* Transcript (collapsed reference) */}
          <details className="rounded border border-line bg-page/60">
            <summary className="cursor-pointer select-none px-3 py-2 text-section font-semibold uppercase tracking-wide text-muted">
              Source transcript
            </summary>
            <p className="whitespace-pre-wrap border-t border-line px-3 py-2 font-mono text-meta leading-relaxed text-ink">
              {detail.transcript.trim() || '—'}
            </p>
          </details>
        </div>
      )}
    </Modal>
  );
}
