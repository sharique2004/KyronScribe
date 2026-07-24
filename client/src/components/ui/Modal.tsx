import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from './cn';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  /** When false, clicking the overlay does nothing (forces an explicit choice). */
  closeOnOverlay?: boolean;
  /** Hide the corner close affordance (e.g. blocking modals like re-login). */
  hideClose?: boolean;
}

const sizes = { sm: 'max-w-sm', md: 'max-w-md', lg: 'max-w-2xl' } as const;

export function Modal({
  open,
  onClose,
  title,
  description,
  footer,
  children,
  size = 'md',
  closeOnOverlay = true,
  hideClose = false,
}: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && closeOnOverlay) onClose();
    };
    document.addEventListener('keydown', onKey);
    // Lock background scroll while the modal is open.
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose, closeOnOverlay]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/40 p-4 py-[8vh]"
      onMouseDown={closeOnOverlay ? onClose : undefined}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        onMouseDown={(e) => e.stopPropagation()}
        className={cn(
          'w-full rounded border border-line bg-surface shadow-overlay',
          sizes[size],
        )}
      >
        {(title != null || !hideClose) && (
          <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-3">
            <div className="min-w-0">
              {title != null && (
                <h2 className="text-body font-semibold text-ink">{title}</h2>
              )}
              {description != null && (
                <p className="mt-0.5 text-meta text-muted">{description}</p>
              )}
            </div>
            {!hideClose && (
              <button
                onClick={onClose}
                aria-label="Close"
                className="-mr-1 -mt-1 rounded p-1 text-muted hover:bg-page hover:text-ink"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path
                    d="M4 4l8 8M12 4l-8 8"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            )}
          </div>
        )}
        <div className="px-5 py-4">{children}</div>
        {footer != null && (
          <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
