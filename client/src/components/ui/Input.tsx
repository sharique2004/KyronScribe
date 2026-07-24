import { forwardRef } from 'react';
import type { InputHTMLAttributes } from 'react';
import { cn } from './cn';

export const inputBase =
  'w-full rounded border border-line bg-surface text-ink placeholder:text-muted/70 ' +
  'transition-colors focus:border-primary focus:ring-2 focus:ring-primary/25 ' +
  'disabled:bg-page disabled:text-muted disabled:cursor-not-allowed';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, invalid, ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      className={cn(
        inputBase,
        'h-9 px-2.5 text-body',
        invalid && 'border-critical focus:border-critical focus:ring-critical/25',
        className,
      )}
      aria-invalid={invalid || undefined}
      {...rest}
    />
  );
});
