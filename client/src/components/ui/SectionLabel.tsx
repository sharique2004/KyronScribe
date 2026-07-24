import type { HTMLAttributes } from 'react';
import { cn } from './cn';

/** 11px uppercase tracked label used above field groups and note sections. */
export function SectionLabel({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('text-section font-semibold uppercase tracking-wide text-muted', className)}
      {...rest}
    >
      {children}
    </div>
  );
}
