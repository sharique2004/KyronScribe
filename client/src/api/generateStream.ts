// OWNED BY A7. Streaming client for POST /api/generate (PRD §6.3).
//
// Reads the SSE response body via ReadableStream + TextDecoder and dispatches
// typed callbacks per event. SSE framing per the A7 wire contract:
//   "event: <name>\n data: <minified json>\n\n"
// Lines beginning with ':' are heartbeat comments and are ignored. Frames are
// delimited by a blank line; CRLF and LF are both handled.
//
// A non-2xx response BEFORE the stream starts (401/403/400) is parsed as the
// standard `{ error: { code, message } }` envelope. The auth tripwires are
// re-emitted on the shared bus so the global ReLoginModal (N2) / lockout (N3)
// still fire even though this call bypasses the api client, then onError runs.

import { bus } from '@/api/events';
import type { NoteContent, RedFlag } from '@/types';
import type { HistoryData } from '@/components/workspace/wireTypes';

export interface GenerateBody {
  patient: { first: string; last: string; dob: string };
  transcript: string;
  templateId: string | null;
}

/** A practice-learned diagnostic lesson applied to this generation (self-improving loop). */
export interface LearnedLesson {
  id: string;
  revisedDx: string;
  lessonSummary: string;
}

export interface GenerateCallbacks {
  onStatus?: (message: string) => void;
  onHistory?: (data: HistoryData) => void;
  onRedFlags?: (flags: RedFlag[]) => void;
  onLearned?: (lessons: LearnedLesson[]) => void;
  onDelta?: (text: string) => void;
  onInsufficient?: (reason: string) => void;
  onComplete?: (note: NoteContent) => void;
  /** Any error: pre-stream HTTP envelope, transport failure, or an `error` frame. */
  onError?: (message: string) => void;
  /** Fires exactly once when the stream terminates (after `done`, EOF, or error). */
  onDone?: () => void;
}

export interface GenerationHandle {
  abort: () => void;
}

/** Best-effort parse of one field out of a data payload. */
function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

export function startGeneration(
  body: GenerateBody,
  cb: GenerateCallbacks,
): GenerationHandle {
  const controller = new AbortController();
  let finished = false;

  const finish = () => {
    if (finished) return;
    finished = true;
    cb.onDone?.();
  };

  const fail = (message: string) => {
    if (finished) return;
    cb.onError?.(message);
    finish();
  };

  const dispatch = (event: string, dataRaw: string) => {
    let data: unknown = undefined;
    if (dataRaw) {
      try {
        data = JSON.parse(dataRaw);
      } catch {
        // Non-JSON data line — ignore malformed frame rather than crashing.
        return;
      }
    }
    const d = (data ?? {}) as Record<string, unknown>;
    switch (event) {
      case 'status':
        cb.onStatus?.(str(d.message));
        break;
      case 'history':
        cb.onHistory?.({
          count: typeof d.count === 'number' ? d.count : 0,
          encounters: Array.isArray(d.encounters)
            ? (d.encounters as HistoryData['encounters'])
            : [],
        });
        break;
      case 'red_flags':
        cb.onRedFlags?.(Array.isArray(d.flags) ? (d.flags as RedFlag[]) : []);
        break;
      case 'learned':
        cb.onLearned?.(Array.isArray(d.lessons) ? (d.lessons as LearnedLesson[]) : []);
        break;
      case 'delta':
        cb.onDelta?.(str(d.text));
        break;
      case 'insufficient':
        cb.onInsufficient?.(str(d.reason, 'No clinically meaningful content identified.'));
        break;
      case 'complete':
        if (d.note) cb.onComplete?.(d.note as NoteContent);
        break;
      case 'error':
        fail(str(d.message, 'Generation failed. Please try again.'));
        break;
      case 'done':
        finish();
        break;
      default:
        // Unknown event name — ignore forward-compatibly.
        break;
    }
  };

  // Parse one SSE frame (a block between blank lines) into event + data.
  const handleFrame = (frame: string) => {
    let event = 'message';
    const dataLines: string[] = [];
    for (const rawLine of frame.split('\n')) {
      const line = rawLine.replace(/\r$/, '');
      if (line === '' || line.startsWith(':')) continue; // heartbeat / blank
      const idx = line.indexOf(':');
      const field = idx === -1 ? line : line.slice(0, idx);
      // Per SSE spec a single leading space after the colon is stripped.
      let value = idx === -1 ? '' : line.slice(idx + 1);
      if (value.startsWith(' ')) value = value.slice(1);
      if (field === 'event') event = value;
      else if (field === 'data') dataLines.push(value);
    }
    if (dataLines.length === 0 && event === 'message') return;
    dispatch(event, dataLines.join('\n'));
  };

  (async () => {
    let res: Response;
    try {
      res = await fetch('/api/generate', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      if (controller.signal.aborted) {
        finish();
        return;
      }
      void err;
      fail('Network error. Check your connection and try again.');
      return;
    }

    // Pre-stream HTTP error: parse the JSON error envelope, re-emit auth
    // tripwires on the bus, and surface an ApiError-shaped message.
    if (!res.ok) {
      let code = 'UNKNOWN';
      let message = `Generation failed (${res.status})`;
      try {
        const j = (await res.json()) as { error?: { code?: string; message?: string } };
        if (j.error?.code) code = j.error.code;
        if (j.error?.message) message = j.error.message;
      } catch {
        /* keep defaults */
      }
      if (res.status === 401 && code === 'SESSION_EXPIRED') bus.emit('session-expired');
      else if (res.status === 403 && code === 'ACCOUNT_DEACTIVATED') bus.emit('account-deactivated');
      fail(message);
      return;
    }

    if (!res.body) {
      fail('The server returned no stream.');
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        // Split off every complete frame; keep the trailing partial in buffer.
        const parts = buffer.split(/\r?\n\r?\n/);
        buffer = parts.pop() ?? '';
        for (const part of parts) {
          if (part.trim() !== '') handleFrame(part);
          if (finished) break;
        }
        if (finished) break;
      }
      // Flush any complete frame left in the buffer at EOF.
      if (!finished && buffer.trim() !== '') handleFrame(buffer);
    } catch (err) {
      if (!controller.signal.aborted) {
        void err;
        fail('The generation stream was interrupted.');
        return;
      }
    } finally {
      try {
        reader.releaseLock();
      } catch {
        /* ignore */
      }
    }

    // EOF without an explicit done/error frame still terminates cleanly.
    finish();
  })();

  return {
    abort: () => {
      if (finished) return;
      finished = true; // suppress onDone/onError races from the abort
      controller.abort();
    },
  };
}
