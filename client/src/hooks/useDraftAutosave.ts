// OWNED BY A7. Server-side draft autosave with a localStorage mirror (PRD §7.4,
// F8, N2). Watches the encounter-in-progress state, debounces 800ms, and PUTs
// to /api/drafts/current wrapped in runWithAuthRetry so a mid-save session
// expiry parks the write and replays it after re-login with zero loss. On mount
// it restores the caller's last draft from the server (falling back to the
// localStorage backup only if the server has none).

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/api/client';
import { useAuth } from '@/auth/AuthContext';
import { useToast } from '@/components/ui/Toast';
import type { Draft, NoteContent } from '@/types';

const LS_KEY = 'kyron.draft';

export interface DraftState {
  patientFirst: string;
  patientLast: string;
  patientDob: string | null;
  templateId: string | null;
  transcript: string;
  noteJson: NoteContent | null;
}

export type AutosaveStatus = 'idle' | 'saving' | 'saved';

interface UseDraftAutosaveArgs {
  enabled: boolean;
  state: DraftState;
  /** Called once, after mount, if a persisted draft is found. */
  onRestore: (draft: Draft) => void;
}

const EMPTY: DraftState = {
  patientFirst: '',
  patientLast: '',
  patientDob: null,
  templateId: null,
  transcript: '',
  noteJson: null,
};

function serialize(s: DraftState): string {
  return JSON.stringify({
    patientFirst: s.patientFirst,
    patientLast: s.patientLast,
    patientDob: s.patientDob,
    templateId: s.templateId,
    transcript: s.transcript,
    noteJson: s.noteJson,
  });
}

const EMPTY_KEY = serialize(EMPTY);

function isEmpty(s: DraftState): boolean {
  return (
    !s.patientFirst.trim() &&
    !s.patientLast.trim() &&
    !s.patientDob &&
    !s.transcript.trim() &&
    !s.noteJson
  );
}

/** Draft → DraftState (identical fields, so keys line up for baseline). */
function draftToState(d: Draft): DraftState {
  return {
    patientFirst: d.patientFirst ?? '',
    patientLast: d.patientLast ?? '',
    patientDob: d.patientDob ?? null,
    templateId: d.templateId ?? null,
    transcript: d.transcript ?? '',
    noteJson: d.noteJson ?? null,
  };
}

function buildBody(s: DraftState): Record<string, unknown> {
  const body: Record<string, unknown> = {
    patientFirst: s.patientFirst,
    patientLast: s.patientLast,
    transcript: s.transcript,
  };
  if (s.patientDob) body.patientDob = s.patientDob;
  if (s.templateId) body.templateId = s.templateId;
  if (s.noteJson) body.noteJson = s.noteJson;
  return body;
}

export function useDraftAutosave({ enabled, state, onRestore }: UseDraftAutosaveArgs) {
  const { runWithAuthRetry } = useAuth();
  const toast = useToast();

  const [status, setStatus] = useState<AutosaveStatus>('idle');
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const loadedRef = useRef(false);
  const suspendedRef = useRef(false);
  const lastKeyRef = useRef<string>(EMPTY_KEY);
  const timerRef = useRef<number | undefined>(undefined);

  const key = serialize(state);

  // --- One-time restore on mount. ---
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    api
      .get<{ draft: Draft | null }>('/drafts/current')
      .then((res) => {
        if (cancelled) return;
        let restored: Draft | null = res.draft;
        if (!restored) {
          // Server has nothing — fall back to the localStorage backup (N2).
          try {
            const raw = localStorage.getItem(LS_KEY);
            if (raw) restored = JSON.parse(raw) as Draft;
          } catch {
            restored = null;
          }
        }
        if (restored) {
          const st = draftToState(restored);
          if (!isEmpty(st)) {
            lastKeyRef.current = serialize(st); // baseline so restore doesn't re-save
            onRestore(restored);
            toast.toast('Draft restored from your last session', { tone: 'neutral' });
          }
        }
      })
      .catch(() => {
        /* no draft / offline — nothing to restore */
      })
      .finally(() => {
        if (!cancelled) loadedRef.current = true;
      });
    return () => {
      cancelled = true;
    };
    // Intentionally run once for the lifetime of the workspace mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  // --- Debounced autosave on change. ---
  useEffect(() => {
    if (!enabled || suspendedRef.current) return;
    if (!loadedRef.current) return; // still restoring
    if (key === lastKeyRef.current) return; // unchanged since last persist
    lastKeyRef.current = key;
    if (isEmpty(state)) return; // nothing worth persisting

    // Mirror immediately for the belt-and-suspenders N2 backup.
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(buildBody(state)));
    } catch {
      /* storage full / disabled — server is the source of truth anyway */
    }

    setStatus('saving');
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      runWithAuthRetry(() => api.put<{ updatedAt: string }>('/drafts/current', buildBody(state)))
        .then(() => {
          setStatus('saved');
          setSavedAt(Date.now());
        })
        .catch(() => {
          // Keep the localStorage backup; surface as idle rather than error-toast
          // on every keystroke failure.
          setStatus('idle');
        });
    }, 800);

    return () => window.clearTimeout(timerRef.current);
    // `state` is intentionally read via closure, not depended on: its identity
    // changes every render, but `key` encodes its content, so the effect (and
    // its debounce-cancelling cleanup) must only re-run when the content moves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled, runWithAuthRetry]);

  /** Delete the persisted draft (after a successful save, or on Discard). */
  const clearDraft = useCallback(
    async (permanent = false) => {
      window.clearTimeout(timerRef.current);
      if (permanent) suspendedRef.current = true;
      lastKeyRef.current = EMPTY_KEY;
      setStatus('idle');
      setSavedAt(null);
      try {
        localStorage.removeItem(LS_KEY);
      } catch {
        /* ignore */
      }
      try {
        await runWithAuthRetry(() => api.del('/drafts/current'));
      } catch {
        /* best effort */
      }
    },
    [runWithAuthRetry],
  );

  return { status, savedAt, clearDraft };
}
