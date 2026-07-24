// OWNED BY A8 — "Add provider" modal (PRD §7.3).
// Collects fullName / credentials / email / temp password (min 8, with a
// generate button), validates client-side, POSTs to /admin/providers, and on
// success surfaces the temp password ONCE with a "share these credentials" hint
// (there is no password-reset flow — §2.3 — so this is the only time it's shown).
import { useState } from 'react';
import { api, ApiError } from '@/api/client';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Banner } from '@/components/ui/Banner';
import { useToast } from '@/components/ui/Toast';
import type {
  AdminProviderRow,
  AdminProviderMutationResponse,
} from './adminTypes';

interface AddProviderModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: (provider: AdminProviderRow) => void;
}

interface FormState {
  fullName: string;
  credentials: string;
  email: string;
  password: string;
}

const EMPTY: FormState = { fullName: '', credentials: '', email: '', password: '' };

type Errors = Partial<Record<keyof FormState, string>>;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function generatePassword(): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnpqrstuvwxyz';
  const digits = '23456789';
  const symbols = '!@#$%&*';
  const all = upper + lower + digits + symbols;
  const pick = (set: string) => set[Math.floor(Math.random() * set.length)];
  // Guarantee one of each class, then fill to 14 chars, then shuffle.
  const chars = [pick(upper), pick(lower), pick(digits), pick(symbols)];
  while (chars.length < 14) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

export function AddProviderModal({ open, onClose, onCreated }: AddProviderModalProps) {
  const toast = useToast();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [errors, setErrors] = useState<Errors>({});
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState<{ provider: AdminProviderRow; password: string } | null>(
    null,
  );

  function reset() {
    setForm(EMPTY);
    setErrors({});
    setSubmitting(false);
    setCreated(null);
  }

  function handleClose() {
    if (submitting) return;
    reset();
    onClose();
  }

  function set<K extends keyof FormState>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  }

  function validate(): boolean {
    const next: Errors = {};
    if (!form.fullName.trim()) next.fullName = 'Full name is required.';
    if (!form.email.trim()) next.email = 'Email is required.';
    else if (!EMAIL_RE.test(form.email.trim())) next.email = 'Enter a valid email address.';
    if (!form.password) next.password = 'A temporary password is required.';
    else if (form.password.length < 8) next.password = 'Must be at least 8 characters.';
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function submit() {
    if (!validate()) return;
    setSubmitting(true);
    try {
      const res = await api.post<AdminProviderMutationResponse>('/admin/providers', {
        email: form.email.trim().toLowerCase(),
        fullName: form.fullName.trim(),
        credentials: form.credentials.trim() || null,
        password: form.password,
      });
      onCreated(res.provider);
      toast.success(`${res.provider.fullName} added to the roster.`);
      setCreated({ provider: res.provider, password: form.password });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'VALIDATION') {
        setErrors((e) => ({ ...e, email: err.message }));
      } else {
        toast.error(err instanceof ApiError ? err.message : 'Could not create provider.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  // Success state: show the credentials once.
  if (created) {
    return (
      <Modal
        open={open}
        onClose={handleClose}
        title="Provider created"
        description="Share these sign-in credentials securely. The password is shown only once."
        footer={
          <Button onClick={handleClose}>Done</Button>
        }
      >
        <div className="flex flex-col gap-3">
          <Banner tone="warning" title="Copy the password now">
            There is no password-reset flow in this demo — if lost, the account must be recreated.
          </Banner>
          <div className="rounded border border-line bg-page/60 p-3 text-body">
            <div className="flex justify-between gap-3 py-1">
              <span className="text-muted">Name</span>
              <span className="font-medium text-ink">{created.provider.fullName}</span>
            </div>
            <div className="flex justify-between gap-3 py-1">
              <span className="text-muted">Email</span>
              <span className="font-mono text-ink">{created.provider.email}</span>
            </div>
            <div className="flex items-center justify-between gap-3 py-1">
              <span className="text-muted">Temp password</span>
              <span className="select-all font-mono font-semibold text-ink">
                {created.password}
              </span>
            </div>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Add provider"
      description="Create a provider account with a temporary password."
      footer={
        <>
          <Button variant="secondary" onClick={handleClose} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={submit} loading={submitting}>
            Create provider
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="flex gap-3">
          <label className="flex flex-1 flex-col gap-1">
            <span className="text-section uppercase tracking-wide text-muted">Full name</span>
            <Input
              value={form.fullName}
              invalid={!!errors.fullName}
              placeholder="Dr. Jane Doe"
              onChange={(e) => set('fullName', e.target.value)}
              autoFocus
            />
            {errors.fullName && <span className="text-meta text-critical">{errors.fullName}</span>}
          </label>
          <label className="flex w-32 flex-col gap-1">
            <span className="text-section uppercase tracking-wide text-muted">Credentials</span>
            <Input
              value={form.credentials}
              placeholder="MD"
              onChange={(e) => set('credentials', e.target.value)}
            />
          </label>
        </div>

        <label className="flex flex-col gap-1">
          <span className="text-section uppercase tracking-wide text-muted">Email</span>
          <Input
            type="email"
            value={form.email}
            invalid={!!errors.email}
            placeholder="jane.doe@kyronhealth.demo"
            onChange={(e) => set('email', e.target.value)}
          />
          {errors.email && <span className="text-meta text-critical">{errors.email}</span>}
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-section uppercase tracking-wide text-muted">
            Temporary password
          </span>
          <div className="flex gap-2">
            <Input
              value={form.password}
              invalid={!!errors.password}
              className="font-mono"
              placeholder="At least 8 characters"
              onChange={(e) => set('password', e.target.value)}
            />
            <Button
              type="button"
              variant="secondary"
              onClick={() => set('password', generatePassword())}
            >
              Generate
            </Button>
          </div>
          {errors.password ? (
            <span className="text-meta text-critical">{errors.password}</span>
          ) : (
            <span className="text-meta text-muted">
              The provider signs in with this and it can be shared once.
            </span>
          )}
        </label>
      </form>
    </Modal>
  );
}
