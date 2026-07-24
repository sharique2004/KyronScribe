import { useState } from 'react';
import type { FormEvent } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Banner } from '@/components/ui/Banner';
import { SectionLabel } from '@/components/ui/SectionLabel';
import { ApiError } from '@/api/client';

interface ReLoginModalProps {
  /** Email of the expired session, pre-filled and read-only. */
  email: string;
  /** Re-authenticate. Resolves on success (queued actions then re-run). */
  onReLogin: (email: string, password: string) => Promise<void>;
  onSignOut: () => void;
}

/**
 * Scenario N2 (PRD §2.1, §7.4): session expired mid-work. Shown OVER the current
 * screen — never navigates away — so the in-memory draft is never lost. On success
 * AuthContext flushes the retry queue and the failed save is re-run automatically.
 */
export function ReLoginModal({ email, onReLogin, onSignOut }: ReLoginModalProps) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await onReLogin(email, password);
      // Success: parent unmounts this modal and replays queued actions.
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Sign-in failed. Please try again.',
      );
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open
      onClose={() => {}}
      closeOnOverlay={false}
      hideClose
      size="sm"
      title="Session expired"
      description="Your session timed out. Sign back in to continue — your work is safe."
    >
      <form onSubmit={submit} className="space-y-3">
        <Banner tone="info">
          Your unsaved note is held in this browser. After you sign in, it will be saved
          automatically.
        </Banner>
        <div className="space-y-1">
          <SectionLabel>Email</SectionLabel>
          <Input value={email} readOnly disabled />
        </div>
        <div className="space-y-1">
          <SectionLabel>Password</SectionLabel>
          <Input
            type="password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter your password"
            invalid={error != null}
          />
        </div>
        {error && (
          <p className="text-meta text-critical" role="alert">
            {error}
          </p>
        )}
        <div className="flex items-center justify-between gap-2 pt-1">
          <Button type="button" variant="ghost" size="sm" onClick={onSignOut}>
            Sign out instead
          </Button>
          <Button type="submit" loading={submitting} disabled={password.length === 0}>
            Sign in and continue
          </Button>
        </div>
      </form>
    </Modal>
  );
}
