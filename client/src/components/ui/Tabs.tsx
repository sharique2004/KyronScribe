import type { ReactNode } from 'react';
import { cn } from './cn';

export interface TabItem {
  id: string;
  label: ReactNode;
  count?: number;
}

interface TabsProps {
  items: TabItem[];
  value: string;
  onChange: (id: string) => void;
  className?: string;
}

/** Underline tabs — dense, bordered baseline, no pill chrome. */
export function Tabs({ items, value, onChange, className }: TabsProps) {
  return (
    <div className={cn('flex items-center gap-1 border-b border-line', className)} role="tablist">
      {items.map((item) => {
        const active = item.id === value;
        return (
          <button
            key={item.id}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(item.id)}
            className={cn(
              '-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-body font-medium transition-colors',
              active
                ? 'border-primary text-ink'
                : 'border-transparent text-muted hover:text-ink',
            )}
          >
            {item.label}
            {item.count != null && (
              <span
                className={cn(
                  'rounded px-1 text-[11px] tabular-nums',
                  active ? 'bg-[#EAF0FC] text-primary' : 'bg-page text-muted',
                )}
              >
                {item.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
