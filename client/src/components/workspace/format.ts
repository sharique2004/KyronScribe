// OWNED BY A7. Small date/time formatting helpers shared across the provider
// screens. Kept dependency-free (Intl only). All timestamps are ISO 8601.

/** "Jul 23, 2026" */
export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** "Jul 23, 2026, 2:14 PM" */
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** DOB is always 'YYYY-MM-DD'; render without timezone drift. */
export function formatDob(dob: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dob);
  if (!m) return dob;
  const [, y, mo, day] = m;
  const d = new Date(Number(y), Number(mo) - 1, Number(day));
  if (Number.isNaN(d.getTime())) return dob;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Compact "saved" relative time for the autosave indicator. */
export function relativeSince(ts: number, now: number = Date.now()): string {
  const secs = Math.max(0, Math.round((now - ts) / 1000));
  if (secs < 5) return 'just now';
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  return `${hrs}h ago`;
}
