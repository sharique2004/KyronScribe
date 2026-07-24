import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/auth/AuthContext';
import { ApiError } from '@/api/client';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Banner } from '@/components/ui/Banner';
import { SectionLabel } from '@/components/ui/SectionLabel';
import { cn } from '@/components/ui/cn';

const DEMO_PASSWORD = 'KyronDemo2026!';
const DEMO_ACCOUNTS = [
  { email: 'dr.chen@kyronhealth.demo', name: 'Dr. Sarah Chen, MD', role: 'Provider' },
  { email: 'dr.patel@kyronhealth.demo', name: 'Dr. Raj Patel, DO', role: 'Provider' },
  { email: 'dr.osei@kyronhealth.demo', name: 'Dr. Ama Osei, MD', role: 'Provider' },
  { email: 'admin@kyronhealth.demo', name: 'Alex Morgan', role: 'Admin' },
] as const;

export function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showDemo, setShowDemo] = useState(true);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(null);
    setSubmitting(true);
    try {
      const user = await login(email, password);
      navigate(user.role === 'admin' ? '/admin' : '/', { replace: true });
    } catch (err) {
      // A pending applicant is a distinct, non-error state — surface it calmly
      // rather than as a wrong-credentials failure.
      if (err instanceof ApiError && err.code === ('PENDING_APPROVAL' as ApiError['code'])) {
        setPending(err.message || 'Your application is awaiting administrator review.');
      } else {
        setError(
          err instanceof ApiError && err.status !== 500 && err.status !== 0
            ? 'Incorrect email or password.'
            : 'Unable to sign in right now. Please try again.',
        );
      }
      setSubmitting(false);
    }
  }

  function useAccount(accountEmail: string) {
    setEmail(accountEmail);
    setPassword(DEMO_PASSWORD);
    setError(null);
    setPending(null);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-page px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-white">
            <svg width="22" height="22" viewBox="0 0 32 32" fill="none">
              <path d="M10 8v16M10 16h5.2M22 8v16" stroke="white" strokeWidth="2.6" strokeLinecap="round" />
              <path d="M15.2 16l6.8-8M15.2 16l6.8 8" stroke="white" strokeWidth="2.6" strokeLinecap="round" />
            </svg>
          </span>
          <div>
            <div className="text-[19px] leading-tight text-ink">
              Kyron<span className="font-semibold">Scribe</span>
            </div>
            <div className="mt-0.5 text-meta text-muted">AI clinical documentation</div>
          </div>
        </div>

        <div className="rounded border border-line bg-surface p-6 shadow-card">
          <form onSubmit={submit} className="space-y-3.5">
            <div className="space-y-1">
              <SectionLabel>Email</SectionLabel>
              <Input
                type="email"
                autoComplete="username"
                autoFocus
                placeholder="you@kyronhealth.demo"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                invalid={error != null}
              />
            </div>
            <div className="space-y-1">
              <SectionLabel>Password</SectionLabel>
              <Input
                type="password"
                autoComplete="current-password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                invalid={error != null}
              />
            </div>
            {pending && (
              <Banner tone="info" title="Application under review">
                {pending}
              </Banner>
            )}
            {error && <Banner tone="critical">{error}</Banner>}
            <Button
              type="submit"
              className="w-full"
              loading={submitting}
              disabled={!email || !password}
            >
              Sign in
            </Button>
          </form>
        </div>

        <p className="mt-4 text-center text-meta text-muted">
          New provider?{' '}
          <Link to="/signup" className="font-medium text-primary hover:underline">
            Request access
          </Link>
        </p>

        <div className="mt-4 rounded border border-line bg-surface shadow-card">
          <button
            type="button"
            onClick={() => setShowDemo((v) => !v)}
            className="flex w-full items-center justify-between px-4 py-2.5 text-left"
          >
            <span className="text-section font-semibold uppercase tracking-wide text-muted">
              Demo accounts
            </span>
            <svg
              width="12"
              height="12"
              viewBox="0 0 12 12"
              fill="none"
              className={cn('text-muted transition-transform', showDemo && 'rotate-180')}
            >
              <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          {showDemo && (
            <div className="border-t border-line px-4 py-3">
              <p className="mb-2 text-meta text-muted">
                Password for all accounts:{' '}
                <code className="rounded bg-page px-1 py-0.5 font-mono text-[12px] text-ink">
                  {DEMO_PASSWORD}
                </code>
              </p>
              <ul className="divide-y divide-line">
                {DEMO_ACCOUNTS.map((a) => (
                  <li key={a.email} className="flex items-center justify-between gap-2 py-1.5">
                    <div className="min-w-0">
                      <div className="truncate text-body text-ink">{a.name}</div>
                      <div className="truncate text-meta text-muted">{a.email}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => useAccount(a.email)}
                      className="shrink-0 rounded border border-line px-2 py-1 text-meta font-medium text-primary hover:bg-page"
                    >
                      Use
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
