// OWNED BY A7. ICD-10 semantic search widget (PRD §7.2, F6). Debounced query →
// GET /api/icd/search → dense top-8 result rows. Clicking a row appends the
// code to the open note's Assessment. Disabled with a hint until a note exists.
import { useEffect, useRef, useState } from 'react';
import { api } from '@/api/client';
import { Input } from '@/components/ui/Input';
import { Spinner } from '@/components/ui/Spinner';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import type { IcdCode, IcdSearchResult } from '@/types';

interface IcdSearchProps {
  enabled: boolean;
  onPick: (code: IcdCode) => void;
}

export function IcdSearch({ enabled, onPick }: IcdSearchProps) {
  const [q, setQ] = useState('');
  const debounced = useDebouncedValue(q.trim(), 300);
  const [results, setResults] = useState<IcdSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const reqRef = useRef(0);

  useEffect(() => {
    if (!enabled || debounced.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    const seq = ++reqRef.current;
    setLoading(true);
    api
      .get<{ results: IcdSearchResult[] }>(`/icd/search?q=${encodeURIComponent(debounced)}`)
      .then((res) => {
        if (seq === reqRef.current) setResults(res.results ?? []);
      })
      .catch(() => {
        if (seq === reqRef.current) setResults([]);
      })
      .finally(() => {
        if (seq === reqRef.current) setLoading(false);
      });
  }, [debounced, enabled]);

  return (
    <div>
      <div className="relative">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          disabled={!enabled}
          placeholder={enabled ? 'Search ICD-10 — e.g. “high blood pressure”' : 'Generate a note to add codes'}
        />
        {loading && (
          <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted">
            <Spinner size={14} />
          </span>
        )}
      </div>

      {!enabled ? (
        <p className="mt-2 text-meta text-muted">
          Plain-English search over 300+ embedded ICD-10 codes. Available once a note is generated.
        </p>
      ) : results.length > 0 ? (
        <ul className="mt-2 divide-y divide-line overflow-hidden rounded border border-line">
          {results.map((r) => (
            <li key={r.code}>
              <button
                type="button"
                onClick={() => onPick({ code: r.code, description: r.description })}
                className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left hover:bg-page"
              >
                <span className="w-16 shrink-0 font-mono text-[12px] font-semibold tracking-tight text-primary">
                  {r.code}
                </span>
                <span className="min-w-0 flex-1 truncate text-body text-ink">{r.description}</span>
                <span className="shrink-0 tabular-nums text-meta text-muted">
                  {Math.round(r.score * 100)}% match
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : debounced.length >= 2 && !loading ? (
        <p className="mt-2 text-meta text-muted">No matching codes.</p>
      ) : null}
    </div>
  );
}
