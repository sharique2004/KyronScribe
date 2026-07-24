import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from './cn';

export type ToastTone = 'neutral' | 'success' | 'warning' | 'critical';

interface ToastOptions {
  tone?: ToastTone;
  title?: string;
  /** ms before auto-dismiss; 0 = sticky. Default 4000. */
  duration?: number;
}

interface ToastItem extends Required<Pick<ToastOptions, 'tone'>> {
  id: number;
  title?: string;
  message: string;
}

interface ToastApi {
  toast: (message: string, opts?: ToastOptions) => void;
  success: (message: string, opts?: Omit<ToastOptions, 'tone'>) => void;
  error: (message: string, opts?: Omit<ToastOptions, 'tone'>) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const accents: Record<ToastTone, string> = {
  neutral: 'border-l-muted',
  success: 'border-l-success',
  warning: 'border-l-warning',
  critical: 'border-l-critical',
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);

  const dismiss = useCallback((id: number) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (message: string, opts: ToastOptions = {}) => {
      const id = ++seq.current;
      const item: ToastItem = {
        id,
        message,
        tone: opts.tone ?? 'neutral',
        title: opts.title,
      };
      setItems((prev) => [...prev, item]);
      const duration = opts.duration ?? 4000;
      if (duration > 0) {
        window.setTimeout(() => dismiss(id), duration);
      }
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(
    () => ({
      toast,
      success: (message, opts) => toast(message, { ...opts, tone: 'success' }),
      error: (message, opts) => toast(message, { ...opts, tone: 'critical', duration: opts?.duration ?? 6000 }),
    }),
    [toast],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      {createPortal(
        <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2">
          {items.map((t) => (
            <div
              key={t.id}
              role="status"
              className={cn(
                'pointer-events-auto flex items-start gap-2 rounded border border-line border-l-[3px] bg-surface px-3 py-2.5 shadow-menu',
                accents[t.tone],
              )}
            >
              <div className="min-w-0 flex-1">
                {t.title && <div className="text-body font-semibold text-ink">{t.title}</div>}
                <div className={cn('text-meta text-muted', t.title && 'mt-0.5')}>{t.message}</div>
              </div>
              <button
                onClick={() => dismiss(t.id)}
                aria-label="Dismiss"
                className="-mr-1 -mt-0.5 rounded p-0.5 text-muted hover:bg-page hover:text-ink"
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                  <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          ))}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within a ToastProvider');
  return ctx;
}
