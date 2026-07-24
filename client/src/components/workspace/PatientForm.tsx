// Patient identity block for the workspace left column (PRD §7.2): first / last / DOB,
// a returning-patient badge (identity-triple lookup), and a fuzzy patient autocomplete —
// typing a name searches existing charts (case-insensitive + trigram similarity + MRN
// prefix) and selecting a result LINKS the note to that exact patient entity, shown as
// an MRN chip. Manual edits after linking unlink (the parent owns that rule).
import { useEffect, useRef, useState } from 'react';
import { api } from '@/api/client';
import { Input } from '@/components/ui/Input';
import { DateInput } from '@/components/ui/DateInput';
import { Badge } from '@/components/ui/Badge';
import { SectionLabel } from '@/components/ui/SectionLabel';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { formatDate, formatDob } from './format';
import type { PatientLookup } from '@/types';

export interface PatientMatch {
  id: string;
  mrn: string;
  firstName: string;
  lastName: string;
  dob: string;
  encounterCount: number;
  lastSeen?: string;
}

interface PatientFormProps {
  first: string;
  last: string;
  dob: string;
  onFirst: (v: string) => void;
  onLast: (v: string) => void;
  onDob: (v: string) => void;
  /** The explicitly linked patient entity, or null when unlinked (identity-triple mode). */
  linked: { id: string; mrn: string } | null;
  onLink: (p: PatientMatch) => void;
  onUnlink: () => void;
  disabled?: boolean;
}

const DOB_RE = /^\d{4}-\d{2}-\d{2}$/;

export function PatientForm({
  first,
  last,
  dob,
  onFirst,
  onLast,
  onDob,
  linked,
  onLink,
  onUnlink,
  disabled,
}: PatientFormProps) {
  const complete = first.trim() !== '' && last.trim() !== '' && DOB_RE.test(dob);
  const debouncedFirst = useDebouncedValue(first.trim(), 400);
  const debouncedLast = useDebouncedValue(last.trim(), 400);
  const debouncedDob = useDebouncedValue(dob, 400);
  const ready =
    debouncedFirst !== '' && debouncedLast !== '' && DOB_RE.test(debouncedDob) && complete;

  const [lookup, setLookup] = useState<PatientLookup | null>(null);

  // Returning-patient badge (identity triple) — still useful when the provider types
  // the full identity without touching the autocomplete.
  useEffect(() => {
    if (!ready || linked) {
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
  }, [ready, debouncedFirst, debouncedLast, debouncedDob, linked]);

  // ── Fuzzy autocomplete over existing charts ──
  const nameQuery = useDebouncedValue(`${first.trim()} ${last.trim()}`.trim(), 300);
  const [matches, setMatches] = useState<PatientMatch[]>([]);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (linked || disabled || nameQuery.length < 2) {
      setMatches([]);
      setOpen(false);
      return;
    }
    let cancelled = false;
    api
      .get<{ patients: PatientMatch[] }>(`/patients/search?q=${encodeURIComponent(nameQuery)}`)
      .then((res) => {
        if (cancelled) return;
        // Hide the dropdown when the only match is already an exact identity match.
        const exact =
          res.patients.length === 1 &&
          res.patients[0]!.firstName.toLowerCase() === first.trim().toLowerCase() &&
          res.patients[0]!.lastName.toLowerCase() === last.trim().toLowerCase() &&
          res.patients[0]!.dob === dob;
        setMatches(res.patients);
        setOpen(res.patients.length > 0 && !exact);
      })
      .catch(() => {
        if (!cancelled) {
          setMatches([]);
          setOpen(false);
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nameQuery, linked, disabled]);

  // Close the dropdown on any outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <SectionLabel>Patient</SectionLabel>
        {linked ? (
          <Badge tone="success" dot>
            Linked · MRN {linked.mrn}
          </Badge>
        ) : lookup?.exists ? (
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

      <div ref={boxRef} className="relative">
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <label className="text-meta text-muted">First name</label>
            <Input
              value={first}
              onChange={(e) => onFirst(e.target.value)}
              onFocus={() => matches.length > 0 && !linked && setOpen(true)}
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
              onFocus={() => matches.length > 0 && !linked && setOpen(true)}
              placeholder="Chen"
              autoComplete="off"
              disabled={disabled}
            />
          </div>
        </div>

        {open && !linked && (
          <ul className="absolute left-0 right-0 top-full z-20 mt-1 max-h-56 overflow-y-auto rounded border border-line bg-surface shadow-md">
            {matches.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  className="flex w-full flex-wrap items-baseline gap-x-2 px-3 py-2 text-left hover:bg-page"
                  onClick={() => {
                    onLink(m);
                    setOpen(false);
                  }}
                >
                  <span className="text-body font-medium text-ink">
                    {m.lastName}, {m.firstName}
                  </span>
                  <span className="text-meta tabular-nums text-muted">DOB {formatDob(m.dob)}</span>
                  <span className="text-meta font-medium tabular-nums text-primary">
                    MRN {m.mrn}
                  </span>
                  <span className="text-meta text-muted">
                    {m.encounterCount} {m.encounterCount === 1 ? 'encounter' : 'encounters'}
                    {m.lastSeen ? ` · last ${formatDate(m.lastSeen)}` : ''}
                  </span>
                </button>
              </li>
            ))}
            <li className="border-t border-line px-3 py-1.5 text-meta text-muted">
              Select to link this note to the existing chart — or keep typing for a new patient.
            </li>
          </ul>
        )}
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

      {linked && (
        <p className="text-meta text-muted">
          This note will attach to the linked chart.{' '}
          <button
            type="button"
            className="font-medium text-primary hover:underline"
            onClick={onUnlink}
            disabled={disabled}
          >
            Unlink
          </button>
        </p>
      )}
      {!linked && lookup?.exists && lookup.lastSeen && (
        <p className="text-meta text-muted">
          Last seen {formatDate(lookup.lastSeen)}. The AI will review prior encounters during
          generation.
        </p>
      )}
    </div>
  );
}
