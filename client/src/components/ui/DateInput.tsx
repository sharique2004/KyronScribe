import { forwardRef } from 'react';
import type { InputHTMLAttributes } from 'react';
import { cn } from './cn';
import { inputBase } from './Input';

interface DateInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  invalid?: boolean;
}

/** Native date picker, styled to match the kit. Values are ISO `yyyy-mm-dd`. */
export const DateInput = forwardRef<HTMLInputElement, DateInputProps>(function DateInput(
  { className, invalid, ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      type="date"
      className={cn(
        inputBase,
        'h-9 px-2.5 text-body tabular-nums',
        invalid && 'border-critical focus:border-critical focus:ring-critical/25',
        className,
      )}
      aria-invalid={invalid || undefined}
      {...rest}
    />
  );
});
