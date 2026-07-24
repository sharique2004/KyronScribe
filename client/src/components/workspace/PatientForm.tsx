// OWNED BY A7. Patient identity block for the workspace left column (PRD §7.2):
// first / last / DOB, plus a returning-patient badge driven by a debounced
// GET /api/patients/lookup once all three fields are complete.
import { useEffect, useState } from 'react';
import { api } from '@/api/client';
import { Input } from '@/components/ui/Input';
import { DateInput } from '@/components/ui/DateInput';
import { Badge } from '@/components/ui/Badge';
import { SectionLabel } from '@/components/ui/SectionLabel';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { formatDate } from './format';
import type { PatientLookup } from '@/types';

interface PatientFormProps {
  first: string;
  last: string;
  dob: string;
  onFirst: (v: string) => void;
  onLast: (v: string) => void;
  onDob: (v: string) => void;
  disabled?: boolean;
}

const DOB_RE = /^\d{4}-\d{2}-\d{2}$/;

export function PatientForm({ first, last, dob, onFirst, onLast, onDob, disabled }: PatientFormProps) {
  const complete = first.trim() !== '' && last.trim() !== '' && DOB_RE.test(dob);
  const debouncedFirst = useDebouncedValue(first.trim(), 400);
  const debouncedLast = useDebouncedValue(last.trim(), 400);
  const debouncedDob = useDebouncedValue(dob, 400);
  const ready =
    debouncedFirst !== '' && debouncedLast !== '' && DOB_RE.test(debouncedDob) && complete;

  const [lookup, setLookup] = useState<PatientLookup | null>(null);

  useEffect(() => {
    if (!ready) {
      setLookup(null);
      return;
    }
    let cancelled = false;
    const params = new URLSearchParams({
      first: debouncedFirst,
      last: debouncedLast,
      dob: debouncedDob,
    });
    api
      .get<PatientLookup>(`/patients/lookup?${params.toString()}`)
      .then((res) => {
        if (!cancelled) setLookup(res);
      })
      .catch(() => {
        if (!cancelled) setLookup(null);
      });
    return () => {
      cancelled = true;
    };
  }, [ready, debouncedFirst, debouncedLast, debouncedDob]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <SectionLabel>Patient</SectionLabel>
        {lookup?.exists ? (
          <Badge tone="primary" dot>
            Returning · {lookup.encounterCount} prior{' '}
            {lookup.encounterCount === 1 ? 'encounter' : 'encounters'}
          </Badge>
        ) : lookup && !lookup.exists ? (
          <Badge tone="neutral" dot>
            New patient
          </Badge>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <label className="text-meta text-muted">First name</label>
          <Input
            value={first}
            onChange={(e) => onFirst(e.target.value)}
            placeholder="Margaret"
            autoComplete="off"
            disabled={disabled}
          />
        </div>
        <div className="space-y-1">
          <label className="text-meta text-muted">Last name</label>
          <Input
            value={last}
            onChange={(e) => onLast(e.target.value)}
            placeholder="Chen"
            autoComplete="off"
            disabled={disabled}
          />
        </div>
      </div>

      <div className="space-y-1">
        <label className="text-meta text-muted">Date of birth</label>
        <DateInput
          value={dob}
          max="9999-12-31"
          onChange={(e) => onDob(e.target.value)}
          disabled={disabled}
        />
      </div>

      {lookup?.exists && lookup.lastSeen && (
        <p className="text-meta text-muted">
          Last seen {formatDate(lookup.lastSeen)}. The AI will review prior encounters during
          generation.
        </p>
      )}
    </div>
  );
}
