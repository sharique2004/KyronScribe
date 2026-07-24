import type { ReactNode } from 'react';
import { cn } from './cn';

export type BannerTone = 'info' | 'warning' | 'critical';

interface BannerProps {
  tone?: BannerTone;
  title?: ReactNode;
  children?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

const tones: Record<BannerTone, string> = {
  info: 'bg-[#EAF0FC] border-[#C6D6F6] text-ink',
  warning: 'bg-[#FEF3E2] border-[#F4D9AE] text-ink',
  critical: 'bg-flag-bg border-[#F3C4C4] text-ink',
};

const iconColor: Record<BannerTone, string> = {
  info: 'text-primary',
  warning: 'text-warning',
  critical: 'text-critical',
};

const defaultIcons: Record<BannerTone, ReactNode> = {
  info: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="6.75" stroke="currentColor" strokeWidth="1.4" />
      <path d="M8 7.2v3.4M8 5.1v.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  ),
  warning: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M8 2l6 11H2L8 2z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M8 6.6v3M8 11.2v.2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  critical: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="6.75" stroke="currentColor" strokeWidth="1.4" />
      <path d="M8 4.6v4M8 11.2v.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  ),
};

export function Banner({ tone = 'info', title, children, icon, actions, className }: BannerProps) {
  return (
    <div
      role={tone === 'critical' ? 'alert' : 'status'}
      className={cn('flex items-start gap-2.5 rounded border px-3 py-2.5', tones[tone], className)}
    >
      <span className={cn('mt-px shrink-0', iconColor[tone])}>{icon ?? defaultIcons[tone]}</span>
      <div className="min-w-0 flex-1">
        {title != null && <div className="text-body font-semibold">{title}</div>}
        {children != null && (
          <div className={cn('text-meta text-muted', title != null && 'mt-0.5')}>{children}</div>
        )}
      </div>
      {actions != null && <div className="ml-1 shrink-0">{actions}</div>}
    </div>
  );
}
