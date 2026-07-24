// OWNED BY A7. Context-transparency panel (PRD §2.2 P3): after generation, show
// exactly which prior encounters the AI consulted (returning patient) or that
// none existed (first-time patient) — making the differential behaviour visible.
import { SectionLabel } from '@/components/ui/SectionLabel';
import { Badge } from '@/components/ui/Badge';
import { formatDate } from './format';
import type { HistoryData } from './wireTypes';
import type { LearnedLesson } from '@/api/generateStream';

interface ContextPanelProps {
  history: HistoryData | null;
  received: boolean;
  /** Practice-learned lessons injected into this generation (self-improving loop). */
  learned?: LearnedLesson[];
}

export function ContextPanel({ history, received, learned = [] }: ContextPanelProps) {
  const hasHistory = received && history != null && history.count > 0;

  return (
    <div className="rounded border border-line bg-page/60 px-3 py-2.5">
      <div className="flex items-center gap-2">
        <span className="text-primary">
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="6.75" stroke="currentColor" strokeWidth="1.4" />
            <path d="M8 7.2v3.4M8 5.1v.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </span>
        <SectionLabel>Context used</SectionLabel>
      </div>

      {hasHistory ? (
        <div className="mt-2 space-y-1.5">
          <p className="text-meta text-muted">
            Referenced {history.count} prior{' '}
            {history.count === 1 ? 'encounter' : 'encounters'} via the clinical database:
          </p>
          <ul className="space-y-1">
            {history.encounters.map((e, i) => (
              <li key={i} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-meta">
                <span className="tabular-nums font-medium text-ink">{formatDate(e.date)}</span>
                <span className="text-muted">·</span>
                <span className="text-muted">{e.provider}</span>
                {e.codes.length > 0 && (
                  <span className="flex flex-wrap gap-1">
                    {e.codes.map((c) => (
                      <Badge key={c} tone="neutral">
                        {c}
                      </Badge>
                    ))}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="mt-1.5 text-meta text-muted">
          First-time patient — generated without prior history.
        </p>
      )}

      {learned.length > 0 && (
        <div className="mt-3 border-t border-line pt-2.5">
          <SectionLabel>Learned patterns applied</SectionLabel>
          <ul className="mt-1.5 space-y-1.5">
            {learned.map((l) => (
              <li key={l.id} className="text-meta">
                <span className="font-medium text-ink">{l.revisedDx}</span>
                <span className="text-muted"> — {l.lessonSummary}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
