// OWNED BY A8 — admin template library CRUD (PRD §7.3, §6.4).
// Master-detail: the template list on the left, an editor on the right.
// Changes read fresh from the DB at generation time, so a save takes effect on
// the provider's very next generation with no refresh — surfaced in the Banner.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '@/api/client';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { Banner } from '@/components/ui/Banner';
import { Badge } from '@/components/ui/Badge';
import { Spinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { useToast } from '@/components/ui/Toast';
import { ConfirmDialog } from '@/components/admin/ConfirmDialog';
import { cn } from '@/components/ui/cn';
import type {
  AdminTemplate,
  AdminTemplatesResponse,
  AdminTemplateMutationResponse,
} from '@/components/admin/adminTypes';
import { formatDate } from '@/components/admin/format';

interface Draft {
  name: string;
  description: string;
  prompt: string;
}

const BLANK: Draft = { name: '', description: '', prompt: '' };

function toDraft(t: AdminTemplate): Draft {
  return { name: t.name, description: t.description ?? '', prompt: t.prompt };
}

function draftsEqual(a: Draft, b: Draft): boolean {
  return a.name === b.name && a.description === b.description && a.prompt === b.prompt;
}

export function AdminTemplates() {
  const toast = useToast();
  const [templates, setTemplates] = useState<AdminTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [draft, setDraft] = useState<Draft>(BLANK);
  const [fieldErrors, setFieldErrors] = useState<{ name?: string; prompt?: string }>({});

  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<AdminTemplate | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [pendingSwitch, setPendingSwitch] = useState<{ id: string | null; isNew: boolean } | null>(
    null,
  );

  const selected = useMemo(
    () => (isNew ? null : templates.find((t) => t.id === selectedId) ?? null),
    [templates, selectedId, isNew],
  );

  const baseline = useMemo<Draft>(
    () => (isNew ? BLANK : selected ? toDraft(selected) : BLANK),
    [isNew, selected],
  );

  const dirty = !draftsEqual(draft, baseline);
  const editing = isNew || selected != null;

  const load = useCallback(async (): Promise<AdminTemplate[]> => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<AdminTemplatesResponse>('/admin/templates');
      setTemplates(res.templates);
      return res.templates;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load templates.');
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load: select the first template.
  useEffect(() => {
    load().then((list) => {
      const first = list[0];
      if (first) {
        setSelectedId(first.id);
        setDraft(toDraft(first));
      }
    });
  }, [load]);

  const applySelection = useCallback(
    (id: string | null, asNew: boolean) => {
      setFieldErrors({});
      setIsNew(asNew);
      setSelectedId(id);
      if (asNew) {
        setDraft(BLANK);
      } else if (id) {
        const t = templates.find((x) => x.id === id);
        if (t) setDraft(toDraft(t));
      }
    },
    [templates],
  );

  const requestSelect = useCallback(
    (id: string | null, asNew: boolean) => {
      if ((isNew && id === null) || (!asNew && id === selectedId)) return;
      if (dirty) {
        setPendingSwitch({ id, isNew: asNew });
      } else {
        applySelection(id, asNew);
      }
    },
    [dirty, isNew, selectedId, applySelection],
  );

  function validate(): boolean {
    const next: { name?: string; prompt?: string } = {};
    if (!draft.name.trim()) next.name = 'Name is required.';
    if (!draft.prompt.trim()) next.prompt = 'Prompt instructions are required.';
    setFieldErrors(next);
    return Object.keys(next).length === 0;
  }

  async function save() {
    if (!validate()) return;
    setSaving(true);
    const body = {
      name: draft.name.trim(),
      description: draft.description.trim() ? draft.description.trim() : null,
      prompt: draft.prompt,
    };
    try {
      if (isNew) {
        const res = await api.post<AdminTemplateMutationResponse>('/admin/templates', body);
        setTemplates((prev) => [...prev, res.template]);
        setIsNew(false);
        setSelectedId(res.template.id);
        setDraft(toDraft(res.template));
        toast.success('Template created.');
      } else if (selectedId) {
        const res = await api.put<AdminTemplateMutationResponse>(
          `/admin/templates/${selectedId}`,
          body,
        );
        setTemplates((prev) => prev.map((t) => (t.id === selectedId ? res.template : t)));
        setDraft(toDraft(res.template));
        toast.success('Template saved.');
      }
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not save template.');
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.del<{ ok: boolean }>(`/admin/templates/${deleteTarget.id}`);
      const remaining = templates.filter((t) => t.id !== deleteTarget.id);
      setTemplates(remaining);
      toast.success('Template deleted.');
      // Move selection to the first remaining template (or clear).
      const first = remaining[0];
      if (first) {
        applySelection(first.id, false);
      } else {
        setSelectedId(null);
        setIsNew(false);
        setDraft(BLANK);
      }
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not delete template.');
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  }

  return (
    <div>
      <PageHeader
        title="Templates"
        description="Prompt templates that shape SOAP generation."
        actions={
          <Button variant="secondary" onClick={() => requestSelect(null, true)}>
            New template
          </Button>
        }
      />

      <Banner tone="info" className="mb-3">
        Template changes apply to every provider&apos;s next generation immediately — no refresh
        needed on their side.
      </Banner>

      {error && (
        <Banner tone="critical" className="mb-3" title="Unable to load templates">
          {error}
        </Banner>
      )}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[280px_minmax(0,1fr)]">
        {/* List */}
        <Card flush bodyClassName="max-h-[70vh] overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-muted">
              <Spinner size={16} />
              <span className="text-meta">Loading…</span>
            </div>
          ) : templates.length === 0 && !isNew ? (
            <div className="px-3 py-8 text-center text-meta text-muted">No templates yet.</div>
          ) : (
            <ul className="divide-y divide-line">
              {isNew && (
                <li>
                  <div className="w-full bg-[#EAF0FC] px-3 py-2.5 text-left">
                    <div className="flex items-center gap-2">
                      <span className="text-body font-medium text-ink">New template</span>
                      <Badge tone="primary">Draft</Badge>
                    </div>
                    <p className="mt-0.5 truncate text-meta text-muted">Unsaved</p>
                  </div>
                </li>
              )}
              {templates.map((t) => {
                const active = !isNew && t.id === selectedId;
                return (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => requestSelect(t.id, false)}
                      className={cn(
                        'w-full px-3 py-2.5 text-left transition-colors hover:bg-page',
                        active && 'bg-[#EAF0FC] hover:bg-[#EAF0FC]',
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <span className="truncate text-body font-medium text-ink">{t.name}</span>
                        {active && dirty && <Badge tone="warning">Unsaved</Badge>}
                      </div>
                      <p className="mt-0.5 truncate text-meta text-muted">
                        {t.description || 'No description'}
                      </p>
                      <p className="mt-0.5 text-[11px] tabular-nums text-muted">
                        Updated {formatDate(t.updatedAt)}
                      </p>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {/* Editor */}
        <Card
          title={isNew ? 'New template' : selected ? selected.name : 'Editor'}
          actions={
            editing ? (
              <div className="flex items-center gap-2">
                {!isNew && selected && (
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => setDeleteTarget(selected)}
                  >
                    Delete
                  </Button>
                )}
                <Button size="sm" onClick={save} loading={saving} disabled={!dirty && !isNew}>
                  {isNew ? 'Create' : 'Save'}
                </Button>
              </div>
            ) : undefined
          }
        >
          {!editing ? (
            <EmptyState
              title="Select a template"
              hint="Choose a template on the left to edit it, or create a new one."
            />
          ) : (
            <div className="flex flex-col gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-section uppercase tracking-wide text-muted">Name</span>
                <Input
                  value={draft.name}
                  invalid={!!fieldErrors.name}
                  placeholder="e.g. Orthopedic Follow-up"
                  onChange={(e) => {
                    setDraft((d) => ({ ...d, name: e.target.value }));
                    setFieldErrors((f) => ({ ...f, name: undefined }));
                  }}
                />
                {fieldErrors.name && (
                  <span className="text-meta text-critical">{fieldErrors.name}</span>
                )}
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-section uppercase tracking-wide text-muted">Description</span>
                <Input
                  value={draft.description}
                  placeholder="Short summary shown in the template selector"
                  onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                />
              </label>

              <label className="flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <span className="text-section uppercase tracking-wide text-muted">
                    Prompt instructions
                  </span>
                  <span className="text-[11px] tabular-nums text-muted">
                    {draft.prompt.length.toLocaleString()} chars
                  </span>
                </div>
                <Textarea
                  mono
                  autosize
                  rows={16}
                  value={draft.prompt}
                  invalid={!!fieldErrors.prompt}
                  className="min-h-[22rem]"
                  placeholder="Appended under ENCOUNTER TYPE INSTRUCTIONS in the system prompt…"
                  onChange={(e) => {
                    setDraft((d) => ({ ...d, prompt: e.target.value }));
                    setFieldErrors((f) => ({ ...f, prompt: undefined }));
                  }}
                />
                {fieldErrors.prompt && (
                  <span className="text-meta text-critical">{fieldErrors.prompt}</span>
                )}
              </label>
            </div>
          )}
        </Card>
      </div>

      {/* Delete confirm */}
      <ConfirmDialog
        open={deleteTarget != null}
        tone="danger"
        title={deleteTarget ? `Delete "${deleteTarget.name}"?` : 'Delete template?'}
        confirmLabel="Delete"
        loading={deleting}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
      >
        This soft-deletes the template so it no longer appears in the selector. Existing encounters
        keep their historical reference to it.
      </ConfirmDialog>

      {/* Unsaved-changes guard */}
      <ConfirmDialog
        open={pendingSwitch != null}
        tone="primary"
        title="Discard unsaved changes?"
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        onCancel={() => setPendingSwitch(null)}
        onConfirm={() => {
          if (pendingSwitch) applySelection(pendingSwitch.id, pendingSwitch.isNew);
          setPendingSwitch(null);
        }}
      >
        You have unsaved edits to this template. Switching will discard them.
      </ConfirmDialog>
    </div>
  );
}
