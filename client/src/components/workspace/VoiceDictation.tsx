// Voice dictation for the transcript (MediaRecorder → POST /api/transcribe → append text).
// Server-side transcription (Gemini multimodal) rather than the browser SpeechRecognition
// API, which several browsers (e.g. Brave) disable; recording works everywhere getUserMedia
// does (HTTPS or localhost). States: idle → recording (timer) → transcribing → done/error.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { useToast } from '@/components/ui/Toast';

const MAX_SECONDS = 300; // 5-minute hard cap per dictation

type Phase = 'idle' | 'recording' | 'transcribing';

interface VoiceDictationProps {
  /** Called with the transcribed text; the workspace appends it to the transcript. */
  onText: (text: string) => void;
  disabled?: boolean;
}

function pickMimeType(): string {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];
  for (const c of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(c)) return c;
  }
  return '';
}

export function VoiceDictation({ onText, disabled }: VoiceDictationProps) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [seconds, setSeconds] = useState(0);
  const [permissionHint, setPermissionHint] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const toast = useToast();

  const stopTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  };

  // Tear down the recorder + mic tracks on unmount.
  useEffect(
    () => () => {
      stopTimer();
      const rec = recorderRef.current;
      if (rec && rec.state !== 'inactive') rec.stop();
      rec?.stream.getTracks().forEach((t) => t.stop());
    },
    [],
  );

  const transcribe = useCallback(
    async (blob: Blob, mime: string) => {
      setPhase('transcribing');
      try {
        const res = await fetch('/api/transcribe', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': mime.split(';')[0] ?? 'audio/webm' },
          body: blob,
        });
        if (!res.ok) {
          let message = `Transcription failed (${res.status}).`;
          try {
            const j = (await res.json()) as { error?: { message?: string } };
            if (j.error?.message) message = j.error.message;
          } catch {
            /* keep default */
          }
          throw new Error(message);
        }
        const { text } = (await res.json()) as { text: string };
        if (text && text.trim()) {
          onText(text.trim());
          toast.success('Dictation added to the transcript.');
        } else {
          toast.error('No speech detected in the recording.');
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Transcription failed.');
      } finally {
        setPhase('idle');
      }
    },
    [onText, toast],
  );

  const start = useCallback(async () => {
    setPermissionHint(false);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setPermissionHint(true);
      return;
    }
    const mime = pickMimeType();
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    chunksRef.current = [];
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      const type = rec.mimeType || mime || 'audio/webm';
      const blob = new Blob(chunksRef.current, { type });
      if (blob.size === 0) {
        setPhase('idle');
        toast.error('Nothing was recorded.');
        return;
      }
      void transcribe(blob, type);
    };
    recorderRef.current = rec;
    rec.start();
    setSeconds(0);
    setPhase('recording');
    timerRef.current = setInterval(() => {
      setSeconds((s) => {
        if (s + 1 >= MAX_SECONDS && recorderRef.current?.state === 'recording') {
          recorderRef.current.stop();
          stopTimer();
        }
        return s + 1;
      });
    }, 1000);
  }, [toast, transcribe]);

  const stop = useCallback(() => {
    stopTimer();
    const rec = recorderRef.current;
    if (rec && rec.state !== 'inactive') rec.stop(); // onstop → transcribe
  }, []);

  const mmss = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;

  return (
    <div className="flex items-center gap-2">
      {phase === 'idle' && (
        <Button variant="ghost" size="sm" onClick={() => void start()} disabled={disabled} type="button">
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" className="mr-1 inline-block">
            <rect x="5.5" y="1.5" width="5" height="8" rx="2.5" stroke="currentColor" strokeWidth="1.4" />
            <path d="M3 7.5a5 5 0 0 0 10 0M8 12.5v2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
          Dictate
        </Button>
      )}
      {phase === 'recording' && (
        <>
          <span className="flex items-center gap-1.5 text-meta text-critical">
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-critical" />
            <span className="tabular-nums">{mmss}</span>
          </span>
          <Button variant="secondary" size="sm" onClick={stop} type="button">
            Stop
          </Button>
        </>
      )}
      {phase === 'transcribing' && (
        <span className="flex items-center gap-1.5 text-meta text-muted">
          <Spinner size={13} />
          Transcribing…
        </span>
      )}
      {permissionHint && phase === 'idle' && (
        <span className="text-meta text-warning">
          Microphone blocked — allow mic access for this site in your browser and try again.
        </span>
      )}
    </div>
  );
}
