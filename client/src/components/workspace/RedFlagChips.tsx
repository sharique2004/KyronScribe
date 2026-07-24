// OWNED BY A7. Clinical red-flag pre-scan surface (PRD §2.2 P1). Renders the
// `<RED_FLAGS>` payload (delivered via the `red_flags` SSE event) as a critical
// banner with severity-tagged chips — shown before the SOAP note finishes.
import { Banner } from '@/components/ui/Banner';
import { Badge } from '@/components/ui/Badge';
import type { RedFlag } from '@/types';

export function RedFlagChips({ flags }: { flags: RedFlag[] }) {
  if (flags.length === 0) return null;
  return (
    <Banner tone="critical" title="Clinical red flags detected">
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {flags.map((f, i) => (
          <Badge key={i} tone={f.severity === 'high' ? 'critical' : 'warning'} dot>
            {f.text}
          </Badge>
        ))}
      </div>
    </Banner>
  );
}
