// OWNED BY A8 — display formatters for admin screens.
// DOB arrives as 'YYYY-MM-DD'; we parse the parts by hand to avoid the
// UTC-midnight timezone shift that `new Date('1955-03-12')` introduces.

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/** 'YYYY-MM-DD' → 'Mar 12, 1955' (timezone-safe). */
export function formatDob(dob: string | null | undefined): string {
  if (!dob) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dob);
  if (!m) return dob;
  const [, y, mo, d] = m;
  const month = MONTHS[Number(mo) - 1] ?? mo;
  return `${month} ${Number(d)}, ${y}`;
}

/** ISO timestamp → 'Jul 23, 2026'. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return '—';
  return `${MONTHS[dt.getMonth()]} ${dt.getDate()}, ${dt.getFullYear()}`;
}

/** ISO timestamp → 'Jul 23, 2026 · 2:14 PM'. */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return '—';
  let h = dt.getHours();
  const min = dt.getMinutes().toString().padStart(2, '0');
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${MONTHS[dt.getMonth()]} ${dt.getDate()}, ${dt.getFullYear()} · ${h}:${min} ${ampm}`;
}

/** Compose a provider's display name with credentials suffix. */
export function withCredentials(name: string, credentials: string | null | undefined): string {
  return credentials ? `${name}, ${credentials}` : name;
}
