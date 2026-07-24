// OWNED BY A7. The workspace right column (PRD §7.2): the note itself across its
// lifecycle — empty → streaming (status line, red-flag chips, S/O/A/P filling
// token-by-token) → complete (editable sections, removable ICD chips, context
// panel, Save / Discard) — plus the insufficient and error terminal states.
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Banner } from '@/components/ui/Banner';
import { EmptyState } from '@/components/ui/EmptyState';
import { Spinner } from '@/components/ui/Spinner';
import { SoapSection } from './SoapSection';
import { RedFlagChips } from './RedFlagChips';
import { ContextPanel } from './ContextPanel';
import { CodeChips } from './CodeChips';
import type { SoapKey } from './streamParser';
import type { HistoryData } from './wireTypes';
import type { NoteContent, RedFlag } from '@/types';
import type { LearnedLesson } from '@/api/generateStream';

export type NotePhase = 'idle' | 'streaming' | 'complete' | 'insufficient' | 'error';

interface LiveSections {
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
  active: SoapKey | null;
}

interface NotePaneProps {
  phase: NotePhase;
  statusMessage: string | null;
  redFlags: RedFlag[];
  history: HistoryData | null;
  historyReceived: boolean;
  live: LiveSections;
  note: NoteContent; // editable working copy (used in complete phase)
  onEditSection: (key: SoapKey, value: string) => void;
  onRemoveCode: (code: string) => void;
  insufficientReason: string | null;
  errorMessage: string | null;
  onSave: () => void;
  onDiscard: () => void;
  saving: boolean;
  canSave: boolean;
  /** Show the P3 context panel — only meaningful after a live generation. */
  showContext: boolean;
  /** Practice-learned lessons applied to this generation (self-improving loop). */
  learned: LearnedLesson[];
}

const noteIcon = (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
    <rect x="4" y="3" width="12" height="14" rx="2" stroke="currentColor" strokeWidth="1.5" />
    <path d="M7 8h6M7 11h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

export function NotePane(props: NotePaneProps) {
  const {
    phase,
    statusMessage,
    redFlags,
    history,
    historyReceived,
    live,
    note,
    onEditSection,
    onRemoveCode,
    insufficientReason,
    errorMessage,
    onSave,
    onDiscard,
    saving,
    canSave,
    showContext,
    learned,
  } = props;

  // --- Idle: nothing generated yet. ---
  if (phase === 'idle') {
    return (
      <Card flush className="min-h-[420px]">
        <EmptyState
          icon={noteIcon}
          title="No note yet"
          hint="Enter the patient, choose a template, and paste the encounter transcript. The structured SOAP note streams in here as it is generated."
        />
      </Card>
    );
  }

  // --- Insufficient: no clinical content (N1). Transcript is preserved. ---
  if (phase === 'insufficient') {
    return (
      <Card flush className="min-h-[420px]">
        <div className="p-4">
          <Banner tone="warning" title="No clinically meaningful content identified">
            {insufficientReason ??
              'The transcript did not contain enough clinical detail to generate a note.'}{' '}
            The transcript was preserved — add detail and generate again.
          </Banner>
        </div>
      </Card>
    );
  }

  // --- Error: generation failed. Transcript intact, Generate re-enabled. ---
  if (phase === 'error') {
    return (
      <Card flush className="min-h-[420px]">
        <div className="p-4">
          <Banner tone="critical" title="Generation failed">
            {errorMessage ?? 'Something went wrong while generating the note.'} Your transcript is
            intact — try generating again.
          </Banner>
        </div>
      </Card>
    );
  }

  const streaming = phase === 'streaming';

  return (
    <Card
      flush
      className="min-h-[420px]"
      title={streaming ? 'Generating note…' : 'Generated note'}
      actions={
        streaming ? (
          <span className="flex items-center gap-1.5 text-meta text-muted">
            <Spinner size={13} /> streaming
          </span>
        ) : (
          <span className="text-meta text-muted">Review, edit, then save</span>
        )
      }
    >
      {/* Status line + learned-pattern chip + red flags appear during streaming, above the sections. */}
      {(streaming || redFlags.length > 0 || learned.length > 0) && (
        <div className="space-y-2.5 border-b border-line px-4 py-3">
          {streaming && statusMessage && (
            <div className="flex items-center gap-2 text-meta text-muted">
              <Spinner size={13} />
              <span>{statusMessage}</span>
            </div>
          )}
          {learned.length > 0 && (
            <div className="flex items-center gap-1.5 text-meta font-medium text-primary">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                <path d="M6 0l1.6 4.4L12 6 7.6 7.6 6 12 4.4 7.6 0 6l4.4-1.6L6 0z" />
              </svg>
              Applying {learned.length} learned diagnostic pattern{learned.length > 1 ? 's' : ''}
            </div>
          )}
          {redFlags.length > 0 && <RedFlagChips flags={redFlags} />}
        </div>
      )}

      {streaming ? (
        <>
          <SoapSection label="Subjective" mode="stream" value={live.subjective} active={live.active === 'subjective'} />
          <SoapSection label="Objective" mode="stream" value={live.objective} active={live.active === 'objective'} />
          <SoapSection label="Assessment" mode="stream" value={live.assessment} active={live.active === 'assessment'} />
          <SoapSection label="Plan" mode="stream" value={live.plan} active={live.active === 'plan'} />
        </>
      ) : (
        <>
          <SoapSection
            label="Subjective"
            mode="edit"
            value={note.subjective}
            onChange={(v) => onEditSection('subjective', v)}
          />
          <SoapSection
            label="Objective"
            mode="edit"
            value={note.objective}
            onChange={(v) => onEditSection('objective', v)}
          />
          <SoapSection
            label="Assessment"
            mode="edit"
            value={note.assessment}
            onChange={(v) => onEditSection('assessment', v)}
            footer={
              <div className="space-y-1.5">
                <div className="text-section font-semibold uppercase tracking-wide text-muted">
                  ICD-10 codes
                </div>
                <CodeChips
                  codes={note.icdCodes}
                  onRemove={onRemoveCode}
                  emptyHint="No codes yet — use the ICD-10 search below to add them."
                />
              </div>
            }
          />
          <SoapSection
            label="Plan"
            mode="edit"
            value={note.plan}
            onChange={(v) => onEditSection('plan', v)}
          />

          <div className="space-y-3 border-t border-line px-4 py-3">
            {showContext && (
              <ContextPanel history={history} received={historyReceived} learned={learned} />
            )}
            <div className="flex items-center justify-end gap-2">
              <Button variant="ghost" onClick={onDiscard} disabled={saving}>
                Discard
              </Button>
              <Button variant="primary" onClick={onSave} loading={saving} disabled={!canSave}>
                Save note
              </Button>
            </div>
          </div>
        </>
      )}
    </Card>
  );
}
