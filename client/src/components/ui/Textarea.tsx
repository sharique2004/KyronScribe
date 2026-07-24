import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import type { TextareaHTMLAttributes } from 'react';
import { cn } from './cn';
import { inputBase } from './Input';

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
  /** Grow to fit content instead of scrolling. */
  autosize?: boolean;
  mono?: boolean;
}

function resize(el: HTMLTextAreaElement) {
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, invalid, autosize, mono, value, onChange, ...rest },
  ref,
) {
  const innerRef = useRef<HTMLTextAreaElement | null>(null);
  useImperativeHandle(ref, () => innerRef.current as HTMLTextAreaElement);

  useEffect(() => {
    if (autosize && innerRef.current) resize(innerRef.current);
  }, [autosize, value]);

  return (
    <textarea
      ref={innerRef}
      value={value}
      onChange={(e) => {
        if (autosize) resize(e.currentTarget);
        onChange?.(e);
      }}
      className={cn(
        inputBase,
        'px-2.5 py-2 text-body',
        autosize ? 'resize-none overflow-hidden' : 'resize-y',
        mono && 'font-mono text-meta leading-relaxed',
        invalid && 'border-critical focus:border-critical focus:ring-critical/25',
        className,
      )}
      aria-invalid={invalid || undefined}
      {...rest}
    />
  );
});
