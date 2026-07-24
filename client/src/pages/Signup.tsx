import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '@/api/client';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Banner } from '@/components/ui/Banner';
import { SectionLabel } from '@/components/ui/SectionLabel';

/** Kyron wordmark lockup, shared with the sign-in screen. */
function Wordmark() {
  return (
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
  );
}

export function Signup() {
  const [fullName, setFullName] = useState('');
  const [credentials, setCredentials] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');

  const [emailError, setEmailError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  // Client-side gates mirroring the server's zod schema (min 8 + match).
  const passwordTooShort = password.length > 0 && password.length < 8;
  const mismatch = confirm.length > 0 && confirm !== password;
  const canSubmit =
    fullName.trim().length > 0 &&
    email.trim().length > 0 &&
    password.length >= 8 &&
    confirm === password;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setEmailError(null);
    setFormError(null);
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await api.post<{ status: string }>('/auth/signup', {
        fullName: fullName.trim(),
        credentials: credentials.trim() || undefined,
        email: email.trim().toLowerCase(),
        password,
      });
      setDone(true);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === 'VALIDATION' && /already exists/i.test(err.message)) {
          setEmailError(err.message);
        } else if (err.code === 'RATE_LIMITED') {
          setFormError('Too many requests. Please wait a few minutes and try again.');
        } else if (err.code === 'VALIDATION') {
          setFormError(err.message);
        } else {
          setFormError('Unable to submit your request right now. Please try again.');
        }
      } else {
        setFormError('Unable to submit your request right now. Please try again.');
      }
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-page px-4 py-10">
      <div className="w-full max-w-sm">
        <Wordmark />

        {done ? (
          <div className="rounded border border-line bg-surface p-6 text-center shadow-card">
            <span className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-[#E6F4F1] text-success">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6" />
                <path d="M8 12.4l2.6 2.6L16 9.4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            <h1 className="text-[16px] font-semibold text-ink">Application received</h1>
            <p className="mx-auto mt-2 max-w-[300px] text-meta leading-relaxed text-muted">
              Access to a clinical record system is granted individually. An administrator
              reviews every request and will enable your account once your credentials are
              verified. You'll be able to sign in as soon as it's approved.
            </p>
            <Link
              to="/login"
              className="mt-4 inline-block text-body font-medium text-primary hover:underline"
            >
              Back to sign in
            </Link>
          </div>
        ) : (
          <>
            <div className="rounded border border-line bg-surface p-6 shadow-card">
              <div className="mb-4">
                <h1 className="text-[16px] font-semibold text-ink">Request access</h1>
                <p className="mt-0.5 text-meta text-muted">
                  Apply for a provider account. An administrator reviews each request.
                </p>
              </div>
              <form onSubmit={submit} className="space-y-3.5" noValidate>
                <div className="space-y-1">
                  <SectionLabel>Full name</SectionLabel>
                  <Input
                    autoFocus
                    autoComplete="name"
                    placeholder="Jordan Rivera"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <SectionLabel>Credentials <span className="font-normal normal-case tracking-normal text-muted/70">· optional</span></SectionLabel>
                  <Input
                    autoComplete="off"
                    placeholder="MD, DO, NP…"
                    value={credentials}
                    onChange={(e) => setCredentials(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <SectionLabel>Email</SectionLabel>
                  <Input
                    type="email"
                    autoComplete="username"
                    placeholder="you@clinic.org"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      if (emailError) setEmailError(null);
                    }}
                    invalid={emailError != null}
                  />
                  {emailError && (
                    <p className="text-meta text-critical">{emailError}</p>
                  )}
                </div>
                <div className="space-y-1">
                  <SectionLabel>Password</SectionLabel>
                  <Input
                    type="password"
                    autoComplete="new-password"
                    placeholder="At least 8 characters"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    invalid={passwordTooShort}
                  />
                  {passwordTooShort && (
                    <p className="text-meta text-critical">Use at least 8 characters.</p>
                  )}
                </div>
                <div className="space-y-1">
                  <SectionLabel>Confirm password</SectionLabel>
                  <Input
                    type="password"
                    autoComplete="new-password"
                    placeholder="Re-enter password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    invalid={mismatch}
                  />
                  {mismatch && (
                    <p className="text-meta text-critical">Passwords don't match.</p>
                  )}
                </div>
                {formError && <Banner tone="critical">{formError}</Banner>}
                <Button
                  type="submit"
                  className="w-full"
                  loading={submitting}
                  disabled={!canSubmit}
                >
                  Request access
                </Button>
              </form>
            </div>

            <p className="mt-4 text-center text-meta text-muted">
              Already have an account?{' '}
              <Link to="/login" className="font-medium text-primary hover:underline">
                Sign in
              </Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
