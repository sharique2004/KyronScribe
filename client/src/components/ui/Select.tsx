import { forwardRef } from 'react';
import type { SelectHTMLAttributes } from 'react';
import { cn } from './cn';
import { inputBase } from './Input';

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean;
}

// Custom chevron (inline SVG data-uri) so we don't inherit the default
// native arrow, which reads as consumer-app.
const chevron =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath d='M3 4.5L6 7.5L9 4.5' stroke='%235B6472' stroke-width='1.4' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E\")";

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className, invalid, children, ...rest },
  ref,
) {
  return (
    <select
      ref={ref}
      className={cn(
        inputBase,
        'h-9 pl-2.5 pr-8 text-body appearance-none bg-no-repeat',
        invalid && 'border-critical focus:border-critical focus:ring-critical/25',
        className,
      )}
      style={{ backgroundImage: chevron, backgroundPosition: 'right 10px center' }}
      aria-invalid={invalid || undefined}
      {...rest}
    >
      {children}
    </select>
  );
});
