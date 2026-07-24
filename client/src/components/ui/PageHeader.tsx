import type { ReactNode } from 'react';
import { cn } from './cn';

interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

/** Page title (18px semibold) + optional description and right-aligned actions. */
export function PageHeader({ title, description, actions, className }: PageHeaderProps) {
  return (
    <div className={cn('mb-4 flex items-start justify-between gap-4', className)}>
      <div className="min-w-0">
        <h1 className="text-title text-ink">{title}</h1>
        {description != null && (
          <p className="mt-1 max-w-2xl text-meta text-muted">{description}</p>
        )}
      </div>
      {actions != null && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}
