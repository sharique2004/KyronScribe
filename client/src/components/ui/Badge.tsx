import type { HTMLAttributes } from 'react';
import { cn } from './cn';

export type BadgeTone = 'neutral' | 'success' | 'warning' | 'critical' | 'primary';

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  dot?: boolean;
}

const tones: Record<BadgeTone, string> = {
  neutral: 'bg-page text-muted border-line',
  success: 'bg-[#E6F4F1] text-success border-[#BFE3DC]',
  warning: 'bg-[#FEF3E2] text-warning border-[#F4D9AE]',
  critical: 'bg-flag-bg text-critical border-[#F3C4C4]',
  primary: 'bg-[#EAF0FC] text-primary border-[#C6D6F6]',
};

const dotColors: Record<BadgeTone, string> = {
  neutral: 'bg-muted',
  success: 'bg-success',
  warning: 'bg-warning',
  critical: 'bg-critical',
  primary: 'bg-primary',
};

export function Badge({ tone = 'neutral', dot, className, children, ...rest }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-medium leading-none',
        tones[tone],
        className,
      )}
      {...rest}
    >
      {dot && <span className={cn('h-1.5 w-1.5 rounded-full', dotColors[tone])} />}
      {children}
    </span>
  );
}
