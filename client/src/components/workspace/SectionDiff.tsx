// OWNED BY A7. Word-level diff of one SOAP section between two versions (PRD
// §2.2 P2). Uses the installed `diff` package (diffWords): insertions render on
// a green background, deletions on a red background with strike-through.
import { diffWords } from 'diff';
import { SectionLabel } from '@/components/ui/SectionLabel';

interface SectionDiffProps {
  label: string;
  before: string;
  after: string;
}

export function SectionDiff({ label, before, after }: SectionDiffProps) {
  const parts = diffWords(before ?? '', after ?? '');
  const unchanged = parts.every((p) => !p.added && !p.removed);

  return (
    <section className="border-b border-line px-4 py-3 last:border-0">
      <SectionLabel className="mb-1.5">{label}</SectionLabel>
      {unchanged && (before || after) ? (
        <p className="whitespace-pre-wrap text-body text-muted">{after || before}</p>
      ) : !before && !after ? (
        <p className="text-body text-muted/60">—</p>
      ) : (
        <p className="whitespace-pre-wrap text-body leading-relaxed text-ink">
          {parts.map((p, i) =>
            p.added ? (
              <span key={i} className="rounded-sm bg-[#DCFCE7] text-[#14532D]">
                {p.value}
              </span>
            ) : p.removed ? (
              <span key={i} className="rounded-sm bg-[#FEE2E2] text-[#7F1D1D] line-through">
                {p.value}
              </span>
            ) : (
              <span key={i}>{p.value}</span>
            ),
          )}
        </p>
      )}
    </section>
  );
}
