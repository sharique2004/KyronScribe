// OWNED BY A7. A single SOAP section card. During streaming it renders the live
// parsed text token-by-token with a blinking caret on the active section
// (satisfying the "progressively renders" requirement visibly). After
// completion it becomes an autosizing, borderless-until-focus editable field.
import type { ReactNode } from 'react';
import { Textarea } from '@/components/ui/Textarea';
import { SectionLabel } from '@/components/ui/SectionLabel';
import { cn } from '@/components/ui/cn';

interface SoapSectionProps {
  label: string;
  mode: 'stream' | 'edit';
  value: string;
  active?: boolean;
  onChange?: (v: string) => void;
  /** Extra content rendered under the section body (e.g. ICD chips). */
  footer?: ReactNode;
}

export function SoapSection({ label, mode, value, active, onChange, footer }: SoapSectionProps) {
  return (
    <section className="border-b border-line px-4 py-3 last:border-0">
      <SectionLabel className="mb-1.5">{label}</SectionLabel>

      {mode === 'stream' ? (
        <div className="min-h-[1.2em] whitespace-pre-wrap text-body text-ink">
          {value ? (
            <span className={cn(active && 'caret-blink')}>{value}</span>
          ) : active ? (
            <span className="caret-blink text-muted" />
          ) : (
            <span className="text-muted/60">—</span>
          )}
        </div>
      ) : (
        <Textarea
          autosize
          value={value}
          onChange={(e) => onChange?.(e.target.value)}
          rows={1}
          className={cn(
            'border-transparent bg-transparent px-2 py-1 shadow-none',
            '-mx-2 w-[calc(100%+1rem)] hover:bg-page/70',
            'focus:border-primary focus:bg-surface',
          )}
        />
      )}

      {footer != null && <div className="mt-2.5">{footer}</div>}
    </section>
  );
}
