import { Button } from '@/components/ui';

interface DeactivatedScreenProps {
  onSignOut: () => void;
}

/**
 * Full-screen lockout for scenario N3 (PRD §2.1, §7.2). Calm and clinical —
 * reassures the provider their work is safe, then routes them to their admin.
 */
export function DeactivatedScreen({ onSignOut }: DeactivatedScreenProps) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-page p-6">
      <div className="w-full max-w-md rounded border border-line bg-surface p-8 text-center shadow-card">
        <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-page text-muted">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <rect x="5" y="10.5" width="14" height="9.5" rx="2" stroke="currentColor" strokeWidth="1.6" />
            <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" stroke="currentColor" strokeWidth="1.6" />
          </svg>
        </div>
        <h1 className="mt-4 text-title text-ink">Your account has been deactivated</h1>
        <p className="mx-auto mt-2 max-w-sm text-body text-muted">
          Your work has been preserved. Please contact your administrator to restore access.
        </p>
        <div className="mt-6">
          <Button variant="secondary" onClick={onSignOut}>
            Sign out
          </Button>
        </div>
      </div>
    </div>
  );
}
