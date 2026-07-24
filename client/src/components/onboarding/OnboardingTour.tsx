// Role-aware first-run tour. Rendered inside the AppShell, so it never appears
// on /login or /signup. Opens when the signed-in user has onboarded === false
// (Wave-2 wire contract); finishing or skipping POSTs onboarding-complete and
// refreshes /auth/me. 'Replay tour' (AppShell) resets the flag and reopens it.
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from '@/api/client';
import { useAuth } from '@/auth/AuthContext';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { cn } from '@/components/ui/cn';

interface TourStep {
  title: string;
  body: string;
  glyph: ReactNode;
}

const g = (paths: ReactNode) => (
  <svg width="30" height="30" viewBox="0 0 24 24" fill="none" className="text-primary">
    {paths}
  </svg>
);

const providerSteps: TourStep[] = [
  {
    title: 'Start a new encounter',
    body: 'Enter the patient, paste or dictate the visit transcript, and pick a note template. Kyron looks up returning patients as you type so history stays connected.',
    glyph: g(
      <>
        <rect x="4" y="3" width="16" height="18" rx="2" stroke="currentColor" strokeWidth="1.5" />
        <path d="M12 8v6M9 11h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </>,
    ),
  },
  {
    title: 'Generate & review',
    body: 'The SOAP note streams in section by section. Red-flag findings surface at the top, ICD-10 codes attach to the right, and every field stays editable — the AI drafts, you sign off.',
    glyph: g(
      <>
        <path d="M4 6h16M4 10h11M4 14h13M4 18h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M17.5 16.5l2 2 3.5-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" transform="translate(-2 0)" />
      </>,
    ),
  },
  {
    title: 'Save & version history',
    body: 'Saving writes an immutable version. Compare any two revisions side by side, restore an earlier one, or print a clean copy for the chart — the full audit trail is always intact.',
    glyph: g(
      <>
        <path d="M12 7v5l3 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M3.5 12a8.5 8.5 0 1 0 2.5-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M6 3v3.5H9.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </>,
    ),
  },
  {
    title: 'Drafts follow you',
    body: 'Work in progress autosaves continuously and syncs across devices. Step away mid-visit and pick up exactly where you left off — nothing is lost to a timeout or a closed tab.',
    glyph: g(
      <>
        <rect x="3" y="5" width="18" height="12" rx="2" stroke="currentColor" strokeWidth="1.5" />
        <path d="M8 20h8M12 17v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M9 11l2 2 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </>,
    ),
  },
];

const adminSteps: TourStep[] = [
  {
    title: 'Oversight across the practice',
    body: 'The Encounters view spans every provider. Filter by clinician, patient, or date to audit documentation and see what the team is producing at a glance.',
    glyph: g(
      <>
        <path d="M3 4h18M3 9h18M3 14h12M3 19h9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </>,
    ),
  },
  {
    title: 'Roster & approvals',
    body: 'New access requests land here for review. Approve to activate an account or reject if credentials don\'t check out — every decision is recorded in the audit log.',
    glyph: g(
      <>
        <circle cx="9" cy="8" r="3" stroke="currentColor" strokeWidth="1.5" />
        <path d="M3.5 19c0-3 2.5-5 5.5-5s5.5 2 5.5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M16 11l2 2 3.5-3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </>,
    ),
  },
  {
    title: 'Templates shape the AI',
    body: 'Templates are the prompts behind every generated note. Edit one and the change flows to the next encounter that uses it — how you standardize documentation across the practice.',
    glyph: g(
      <>
        <rect x="4" y="4" width="16" height="16" rx="2" stroke="currentColor" strokeWidth="1.5" />
        <path d="M4 9h16M10 9v11" stroke="currentColor" strokeWidth="1.5" />
      </>,
    ),
  },
];

export function OnboardingTour() {
  const { user, refreshMe } = useAuth();
  const [visible, setVisible] = useState(false);
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);

  // Open whenever a signed-in user is explicitly not yet onboarded. Gating on
  // `=== false` (not falsy) keeps the tour dormant if the field is ever absent.
  useEffect(() => {
    if (user && user.onboarded === false) {
      setIndex(0);
      setVisible(true);
    }
  }, [user, user?.onboarded]);

  if (!user || !visible) return null;

  const steps = user.role === 'admin' ? adminSteps : providerSteps;
  const safeIndex = Math.min(index, steps.length - 1);
  const step = steps[safeIndex];
  if (!step) return null;
  const isFirst = safeIndex === 0;
  const isLast = safeIndex === steps.length - 1;

  async function finish() {
    setBusy(true);
    // Close optimistically so the user is never trapped, even if the write fails.
    setVisible(false);
    try {
      await api.post('/auth/onboarding-complete');
      await refreshMe();
    } catch {
      /* best-effort; the tour is already dismissed for this session */
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={visible}
      onClose={finish}
      size="sm"
      closeOnOverlay={false}
      hideClose
      title={step.title}
      footer={
        <div className="flex w-full items-center justify-between">
          <Button variant="ghost" size="sm" onClick={finish} disabled={busy}>
            Skip tour
          </Button>
          <div className="flex items-center gap-2">
            {!isFirst && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setIndex((i) => Math.max(0, i - 1))}
                disabled={busy}
              >
                Back
              </Button>
            )}
            {isLast ? (
              <Button size="sm" onClick={finish} loading={busy}>
                Get started
              </Button>
            ) : (
              <Button size="sm" onClick={() => setIndex((i) => i + 1)} disabled={busy}>
                Next
              </Button>
            )}
          </div>
        </div>
      }
    >
      <div className="flex flex-col items-center text-center">
        <span className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-[#EAF0FC]">
          {step.glyph}
        </span>
        <p className="text-body leading-relaxed text-muted">{step.body}</p>
        <div className="mt-4 flex items-center justify-center gap-1.5" aria-hidden>
          {steps.map((_, i) => (
            <span
              key={i}
              className={cn(
                'h-1.5 rounded-full transition-all',
                i === safeIndex ? 'w-4 bg-primary' : 'w-1.5 bg-line',
              )}
            />
          ))}
        </div>
      </div>
    </Modal>
  );
}
