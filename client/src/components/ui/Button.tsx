import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from './cn';
import { Spinner } from './Spinner';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  leftIcon?: ReactNode;
}

const base =
  'inline-flex items-center justify-center gap-1.5 font-medium rounded border select-none ' +
  'transition-colors focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1 ' +
  'disabled:opacity-50 disabled:pointer-events-none whitespace-nowrap';

const variants: Record<ButtonVariant, string> = {
  primary:
    'bg-primary text-white border-primary hover:bg-primary-hover hover:border-primary-hover',
  secondary:
    'bg-surface text-ink border-line hover:bg-page hover:border-[#CBD5E1]',
  ghost:
    'bg-transparent text-muted border-transparent hover:bg-page hover:text-ink',
  danger:
    'bg-critical text-white border-critical hover:bg-[#A21616] hover:border-[#A21616]',
};

const sizes: Record<ButtonSize, string> = {
  sm: 'h-7 px-2.5 text-meta',
  md: 'h-9 px-3.5 text-body',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading = false, leftIcon, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      className={cn(base, variants[variant], sizes[size], className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Spinner size={size === 'sm' ? 13 : 15} /> : leftIcon}
      {children}
    </button>
  );
});
