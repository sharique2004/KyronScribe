// OWNED BY A7. ICD-10 code chips shown under the Assessment section. Removable
// in edit/generation contexts; static in read views.
import type { IcdCode } from '@/types';

interface CodeChipsProps {
  codes: IcdCode[];
  onRemove?: (code: string) => void;
  emptyHint?: string;
}

export function CodeChips({ codes, onRemove, emptyHint }: CodeChipsProps) {
  if (codes.length === 0) {
    return emptyHint ? <p className="text-meta text-muted">{emptyHint}</p> : null;
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {codes.map((c) => (
        <span
          key={c.code}
          title={c.description}
          className="inline-flex items-center gap-1.5 rounded border border-[#C6D6F6] bg-[#EAF0FC] py-0.5 pl-1.5 pr-1 text-[11px] leading-none text-primary"
        >
          <span className="font-mono font-semibold tracking-tight">{c.code}</span>
          <span className="max-w-[16rem] truncate font-medium text-ink/80">{c.description}</span>
          {onRemove && (
            <button
              type="button"
              onClick={() => onRemove(c.code)}
              aria-label={`Remove ${c.code}`}
              className="ml-0.5 rounded p-0.5 text-primary/70 hover:bg-white/70 hover:text-critical"
            >
              <svg width="10" height="10" viewBox="0 0 16 16" fill="none">
                <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </button>
          )}
        </span>
      ))}
    </div>
  );
}
