import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from './cn';

interface CardProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** Remove inner padding (e.g. for a flush table). */
  flush?: boolean;
  bodyClassName?: string;
}

/** Bordered white surface with the design-system card shadow (§7.1). */
export function Card({
  title,
  description,
  actions,
  flush,
  className,
  bodyClassName,
  children,
  ...rest
}: CardProps) {
  const hasHeader = title != null || actions != null;
  return (
    <div
      className={cn('rounded border border-line bg-surface shadow-card', className)}
      {...rest}
    >
      {hasHeader && (
        <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-2.5">
          <div className="min-w-0">
            {title != null && (
              <h3 className="truncate text-body font-semibold text-ink">{title}</h3>
            )}
            {description != null && (
              <p className="mt-0.5 text-meta text-muted">{description}</p>
            )}
          </div>
          {actions != null && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={cn(!flush && 'p-4', bodyClassName)}>{children}</div>
    </div>
  );
}
