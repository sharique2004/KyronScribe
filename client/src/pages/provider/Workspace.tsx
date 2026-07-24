// OWNED BY A7 — provider encounter workspace, the money screen (PRD §7.2).
// Left column: patient identity, template, transcript, Generate + autosave.
// Right column: the streaming/editable SOAP note and the ICD-10 search widget.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '@/api/client';
import { useAuth } from '@/auth/AuthContext';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { SectionLabel } from '@/components/ui/SectionLabel';
import { Modal } from '@/components/ui/Modal';
import { Spinner } from '@/components/ui/Spinner';
import { useToast } from '@/components/ui/Toast';
import { PatientForm } from '@/components/workspace/PatientForm';
import { NotePane } from '@/components/workspace/NotePane';
import type { NotePhase } from '@/components/workspace/NotePane';
import { IcdSearch } from '@/components/workspace/IcdSearch';
import { parseSoapStream } from '@/components/workspace/streamParser';
import type { SoapKey } from '@/components/workspace/streamParser';
import { relativeSince } from '@/components/workspace/format';
import type { HistoryData } from '@/components/workspace/wireTypes';
import { startGeneration } from '@/api/generateStream';
import type { GenerationHandle, LearnedLesson } from '@/api/generateStream';
import { VoiceDictation } from '@/components/workspace/VoiceDictation';
import { useDraftAutosave } from '@/hooks/useDraftAutosave';
import type { Draft, IcdCode, NoteContent, RedFlag, Template } from '@/types';

const EMPTY_NOTE: NoteContent = {
  subjective: '',
  objective: '',
  assessment: '',
  plan: '',
  icdCodes: [],
  redFlags: [],
};

const DOB_RE = /^\d{4}-\d{2}-\d{2}$/;

export function Workspace() {
  const { user, runWithAuthRetry } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  // --- Encounter setup (left column). ---
  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  const [dob, setDob] = useState('');
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [transcript, setTranscript] = useState('');
  const [templates, setTemplates] = useState<Template[]>([]);

  // --- Note lifecycle (right column). ---
  const [phase, setPhase] = useState<NotePhase>('idle');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [redFlags, setRedFlags] = useState<RedFlag[]>([]);
  const [history, setHistory] = useState<HistoryData | null>(null);
  const [historyReceived, setHistoryReceived] = useState(false);
  const [learned, setLearned] = useState<LearnedLesson[]>([]);
  const [rawDelta, setRawDelta] = useState('');
  const [note, setNote] = useState<NoteContent>(EMPTY_NOTE);
  const [insufficientReason, setInsufficientReason] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showContext, setShowContext] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const genRef = useRef<GenerationHandle | null>(null);
  const outcomeRef = useRef<'none' | 'complete' | 'insufficient' | 'error'>('none');

  const live = useMemo(() => parseSoapStream(rawDelta), [rawDelta]);

  // --- Load templates; default to "General SOAP" without clobbering a restore. ---
  useEffect(() => {
    api
      .get<{ templates: Template[] }>('/templates')
      .then((res) => {
        setTemplates(res.templates);
        const def = res.templates.find((t) => t.name === 'General SOAP') ?? res.templates[0];
        if (def) setTemplateId((prev) => prev ?? def.id);
      })
      .catch(() => setTemplates([]));
  }, []);

  // --- Autosave / restore. ---
  const noteJson = phase === 'complete' ? note : null;
  const onRestore = useCallback((d: Draft) => {
    setFirst(d.patientFirst ?? '');
    setLast(d.patientLast ?? '');
    setDob(d.patientDob ?? '');
    if (d.templateId) setTemplateId(d.templateId);
    setTranscript(d.transcript ?? '');
    if (d.noteJson) {
      setNote({ ...EMPTY_NOTE, ...d.noteJson });
      setRedFlags(d.noteJson.redFlags ?? []);
      setPhase('complete');
      setShowContext(false); // restored, not freshly generated
    }
  }, []);

  const { status: saveStatus, savedAt, clearDraft } = useDraftAutosave({
    enabled: Boolean(user),
    state: {
      patientFirst: first,
      patientLast: last,
      patientDob: dob ? dob : null,
      templateId,
      transcript,
      noteJson,
    },
    onRestore,
  });

  // Ticking clock so "Draft saved · Xs ago" stays fresh.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 15000);
    return () => window.clearInterval(id);
  }, []);

  // Cancel any in-flight generation on unmount.
  useEffect(() => () => genRef.current?.abort(), []);

  const streaming = phase === 'streaming';
  const dobValid = DOB_RE.test(dob);
  const canGenerate =
    first.trim() !== '' && last.trim() !== '' && dobValid && transcript.trim() !== '' && !streaming;
  const canSave =
    phase === 'complete' &&
    first.trim() !== '' &&
    last.trim() !== '' &&
    dobValid &&
    (note.subjective.trim() !== '' ||
      note.objective.trim() !== '' ||
      note.assessment.trim() !== '' ||
      note.plan.trim() !== '');

  // --- Generate. ---
  const handleGenerate = useCallback(() => {
    if (!canGenerate) return;
    genRef.current?.abort();
    outcomeRef.current = 'none';
    setPhase('streaming');
    setStatusMessage('Preparing…');
    setRedFlags([]);
    setHistory(null);
    setHistoryReceived(false);
    setLearned([]);
    setRawDelta('');
    setNote(EMPTY_NOTE);
    setInsufficientReason(null);
    setErrorMessage(null);
    setShowContext(false);

    genRef.current = startGeneration(
      { patient: { first: first.trim(), last: last.trim(), dob }, transcript, templateId },
      {
        onStatus: (m) => setStatusMessage(m),
        onHistory: (h) => {
          setHistory(h);
          setHistoryReceived(true);
        },
        onLearned: (lessons) => setLearned(lessons),
        onRedFlags: (flags) => setRedFlags(flags),
        onDelta: (text) => setRawDelta((prev) => prev + text),
        onInsufficient: (reason) => {
          outcomeRef.current = 'insufficient';
          setInsufficientReason(reason);
          setPhase('insufficient');
        },
        onComplete: (n) => {
          outcomeRef.current = 'complete';
          setNote({ ...EMPTY_NOTE, ...n });
          setRedFlags(n.redFlags ?? []);
          setShowContext(true);
          setPhase('complete');
        },
        onError: (msg) => {
          outcomeRef.current = 'error';
          setErrorMessage(msg);
          setPhase('error');
        },
        onDone: () => {
          if (outcomeRef.current === 'none') {
            setErrorMessage('The generation ended unexpectedly. Please try again.');
            setPhase('error');
          }
          genRef.current = null;
        },
      },
    );
  }, [canGenerate, first, last, dob, transcript, templateId]);

  // --- Inline edits. ---
  const handleEditSection = useCallback((key: SoapKey, value: string) => {
    setNote((prev) => ({ ...prev, [key]: value }));
  }, []);
  const handleRemoveCode = useCallback((code: string) => {
    setNote((prev) => ({ ...prev, icdCodes: prev.icdCodes.filter((c) => c.code !== code) }));
  }, []);
  const handleAddCode = useCallback(
    (code: IcdCode) => {
      // Duplicate check + toasts stay in the event handler — state updaters must be
      // pure (no setState on ToastProvider mid-render, no double-fire under StrictMode).
      if (note.icdCodes.some((c) => c.code === code.code)) {
        toast.toast(`${code.code} is already in the assessment`, { tone: 'warning' });
        return;
      }
      setNote((prev) => ({ ...prev, icdCodes: [...prev.icdCodes, code] }));
      toast.success(`Added ${code.code}`);
    },
    [note.icdCodes, toast],
  );

  // --- Save note (N2: runWithAuthRetry replays across a session expiry). ---
  const handleSave = useCallback(async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const res = await runWithAuthRetry(() =>
        api.post<{ encounterId: string; noteId: string; versionNo: number }>('/encounters', {
          patient: { first: first.trim(), last: last.trim(), dob },
          templateId,
          transcript,
          note: {
            subjective: note.subjective,
            objective: note.objective,
            assessment: note.assessment,
            plan: note.plan,
            icdCodes: note.icdCodes,
            redFlags: note.redFlags,
          },
        }),
      );
      await clearDraft(true);
      toast.success('Note saved');
      navigate(`/encounters/${res.encounterId}`);
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : 'Could not save the note. Please try again.';
      toast.error(message);
      setSaving(false);
    }
  }, [canSave, runWithAuthRetry, first, last, dob, templateId, transcript, note, clearDraft, toast, navigate]);

  // --- Discard. ---
  const resetAll = useCallback(() => {
    genRef.current?.abort();
    genRef.current = null;
    outcomeRef.current = 'none';
    setFirst('');
    setLast('');
    setDob('');
    setTranscript('');
    setPhase('idle');
    setStatusMessage(null);
    setRedFlags([]);
    setHistory(null);
    setHistoryReceived(false);
    setRawDelta('');
    setNote(EMPTY_NOTE);
    setInsufficientReason(null);
    setErrorMessage(null);
    setShowContext(false);
    const def = templates.find((t) => t.name === 'General SOAP') ?? templates[0];
    setTemplateId(def ? def.id : null);
  }, [templates]);

  const handleDiscardConfirmed = useCallback(() => {
    setConfirmDiscard(false);
    resetAll();
    void clearDraft(false);
  }, [resetAll, clearDraft]);

  const autosaveLabel =
    saveStatus === 'saving'
      ? 'Saving…'
      : saveStatus === 'saved' && savedAt
        ? `Draft saved · ${relativeSince(savedAt, now)}`
        : 'Autosaves as you type';

  return (
    <div>
      <PageHeader
        title="New Encounter"
        description="Enter the patient, paste the transcript, and generate a structured SOAP note."
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(340px,400px)_1fr]">
        {/* Left: encounter setup */}
        <div className="space-y-4">
          <Card>
            <div className="space-y-4">
              <PatientForm
                first={first}
                last={last}
                dob={dob}
                onFirst={setFirst}
                onLast={setLast}
                onDob={setDob}
                disabled={streaming}
              />

              <div className="space-y-1">
                <SectionLabel>Template</SectionLabel>
                <Select
                  value={templateId ?? ''}
                  onChange={(e) => setTemplateId(e.target.value || null)}
                  disabled={streaming || templates.length === 0}
                >
                  {templates.length === 0 && <option value="">Loading…</option>}
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </Select>
                {templateId && (
                  <p className="text-meta text-muted">
                    {templates.find((t) => t.id === templateId)?.description ?? ''}
                  </p>
                )}
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <SectionLabel>Transcript</SectionLabel>
                  <VoiceDictation
                    disabled={streaming}
                    onText={(text) =>
                      setTranscript((prev) => (prev.trim() ? `${prev.trimEnd()}\n\n${text}` : text))
                    }
                  />
                </div>
                <Textarea
                  mono
                  rows={14}
                  value={transcript}
                  onChange={(e) => setTranscript(e.target.value)}
                  disabled={streaming}
                  placeholder="Paste the raw encounter transcript, type freeform observations, or dictate…"
                  className="resize-y"
                />
              </div>

              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-1.5 text-meta text-muted" aria-live="polite">
                  {saveStatus === 'saving' && <Spinner size={12} />}
                  {autosaveLabel}
                </span>
                <Button onClick={handleGenerate} loading={streaming} disabled={!canGenerate}>
                  {streaming ? 'Generating…' : 'Generate note'}
                </Button>
              </div>
            </div>
          </Card>
        </div>

        {/* Right: the note + ICD search */}
        <div className="space-y-4">
          <NotePane
            phase={phase}
            statusMessage={statusMessage}
            redFlags={redFlags}
            history={history}
            historyReceived={historyReceived}
            live={live}
            note={note}
            onEditSection={handleEditSection}
            onRemoveCode={handleRemoveCode}
            insufficientReason={insufficientReason}
            errorMessage={errorMessage}
            onSave={handleSave}
            onDiscard={() => setConfirmDiscard(true)}
            saving={saving}
            canSave={canSave}
            showContext={showContext}
            learned={learned}
          />

          <Card title="ICD-10 search" description="Semantic search · click a result to add it to the Assessment">
            <IcdSearch enabled={phase === 'complete'} onPick={handleAddCode} />
          </Card>
        </div>
      </div>

      <Modal
        open={confirmDiscard}
        onClose={() => setConfirmDiscard(false)}
        title="Discard this encounter?"
        description="The transcript, generated note, and draft will be cleared. This cannot be undone."
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmDiscard(false)}>
              Keep editing
            </Button>
            <Button variant="danger" onClick={handleDiscardConfirmed}>
              Discard
            </Button>
          </>
        }
      >
        <p className="text-body text-muted">
          You are about to clear the current encounter and delete its saved draft.
        </p>
      </Modal>
    </div>
  );
}
