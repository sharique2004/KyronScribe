import type { ReactNode } from 'react';
import { cn } from './cn';

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  hint?: ReactNode;
  action?: ReactNode;
  className?: string;
}

/** Centered placeholder for empty tables, un-generated notes, etc. */
export function EmptyState({ icon, title, hint, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-2 px-6 py-12 text-center',
        className,
      )}
    >
      {icon && (
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-page text-muted">
          {icon}
        </div>
      )}
      <div className="text-body font-semibold text-ink">{title}</div>
      {hint && <div className="max-w-sm text-meta text-muted">{hint}</div>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
