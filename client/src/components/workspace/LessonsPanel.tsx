// Diagnostic-revision lessons for a patient (the visible half of the self-improving loop):
// when a later encounter revised the diagnosis, the reflection engine records what the
// original presentation contained, what workup would have discriminated earlier, and the
// forward-looking lesson now retrieved into future generations. Rendered on the encounter
// chart; omitted entirely when the patient has no lessons.
import { useEffect, useState } from 'react';
import { api } from '@/api/client';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { SectionLabel } from '@/components/ui/SectionLabel';
import { formatDate } from './format';

export interface LessonWire {
  id: string;
  initialDx: string;
  revisedDx: string;
  missedSignals: string;
  recommendedWorkup: string;
  lessonSummary: string;
  fromEncounterId: string;
  toEncounterId: string;
  createdAt: string;
}

export function LessonsPanel({ patientId }: { patientId: string }) {
  const [lessons, setLessons] = useState<LessonWire[]>([]);

  useEffect(() => {
    let cancelled = false;
    api
      .get<{ lessons: LessonWire[] }>(`/patients/${patientId}/lessons`)
      .then((r) => {
        if (!cancelled) setLessons(r.lessons);
      })
      .catch(() => {
        /* lessons are an enrichment — never block the chart on them */
      });
    return () => {
      cancelled = true;
    };
  }, [patientId]);

  if (lessons.length === 0) return null;

  return (
    <Card title="Diagnostic revisions">
      <div className="space-y-4">
        {lessons.map((l) => (
          <div key={l.id} className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="warning">Revised</Badge>
              <span className="text-body font-medium text-ink">
                {l.initialDx}
                <span className="mx-1.5 text-muted">→</span>
                {l.revisedDx}
              </span>
              <span className="text-meta tabular-nums text-muted">{formatDate(l.createdAt)}</span>
            </div>
            <div className="space-y-1.5 border-l-2 border-line pl-3">
              <div>
                <SectionLabel>Missed signals</SectionLabel>
                <p className="mt-0.5 text-meta text-ink">{l.missedSignals}</p>
              </div>
              <div>
                <SectionLabel>Recommended workup</SectionLabel>
                <p className="mt-0.5 text-meta text-ink">{l.recommendedWorkup}</p>
              </div>
              <div>
                <SectionLabel>Lesson</SectionLabel>
                <p className="mt-0.5 text-meta text-ink">
                  {l.lessonSummary}
                  <span className="text-muted">
                    {' '}
                    — now retrieved automatically into future generations for similar presentations.
                  </span>
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
