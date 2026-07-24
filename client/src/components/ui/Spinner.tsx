import { cn } from './cn';

interface SpinnerProps {
  size?: number;
  className?: string;
  label?: string;
}

/** Thin ring spinner. `currentColor`-aware so it inherits from its context. */
export function Spinner({ size = 16, className, label }: SpinnerProps) {
  return (
    <span
      role="status"
      aria-label={label ?? 'Loading'}
      className={cn('inline-block animate-spin rounded-full border-2 border-current border-t-transparent align-[-2px]', className)}
      style={{ width: size, height: size, opacity: 0.85 }}
    />
  );
}
