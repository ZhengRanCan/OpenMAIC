'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useI18n } from '@/lib/hooks/use-i18n';
import {
  LEARNER_PROFILE_NAME_MAX,
  type LearnerProfileSummary,
} from '@/lib/learner-context/learner-profile-contracts';
import {
  PROFILE_MEMORY_FIELDS_MAX,
  PROFILE_MEMORY_SECTIONS,
  type ProfileMemoryEdit,
  type ProfileMemoryItem,
  type ProfileMemorySource,
  type ProfileMemoryView,
} from '@/lib/learner-memory/profile-memory-contracts';

const PERSONAL_FIELDS = ['background', 'goals', 'preferences'] as const;

export function LearnerProfileMemoryDialog({
  profile,
  onClose,
  onName,
  returnFocus,
}: {
  profile: LearnerProfileSummary;
  onClose: () => void;
  onName: (profile: LearnerProfileSummary) => void;
  returnFocus: () => void;
}) {
  const { t } = useI18n();
  const [view, setView] = useState<ProfileMemoryView>();
  const [draft, setDraft] = useState<ProfileMemoryEdit>();
  const [readFailed, setReadFailed] = useState(false);
  const [saveError, setSaveError] = useState<'conflict' | 'saveFailed'>();
  const [saving, setSaving] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const endpoint = `/api/learner-profiles/${encodeURIComponent(profile.id)}/memory`;

  useEffect(() => {
    const abort = new AbortController();
    void fetch(endpoint, { cache: 'no-store', signal: abort.signal })
      .then(async (reply) => {
        if (!reply.ok) throw new Error('Profile unavailable');
        const latest = (await reply.json()) as ProfileMemoryView;
        if (!abort.signal.aborted) setView(latest);
      })
      .catch(() => {
        if (!abort.signal.aborted) setReadFailed(true);
      });
    return () => abort.abort();
  }, [endpoint, refresh]);

  function reload() {
    setReadFailed(false);
    setRefresh((n) => n + 1);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft?.name.trim() || saving) return;
    setSaving(true);
    setSaveError(undefined);
    try {
      const reply = await fetch(endpoint, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      });
      if (reply.status === 409) {
        setSaveError('conflict');
        reload();
        return;
      }
      if (!reply.ok) throw new Error('Profile update failed');
      const saved = (await reply.json()) as ProfileMemoryView;
      setView(saved);
      setDraft(undefined);
      onName(saved.profile);
    } catch {
      setSaveError('saveFailed');
    } finally {
      setSaving(false);
    }
  }

  const name = view?.profile.name ?? profile.name ?? t('learnerProfiles.unnamed');
  return (
    <Dialog
      open
      onOpenChange={(value) => {
        if (!value && !saving) onClose();
      }}
    >
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] overflow-y-auto sm:max-w-2xl"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocus();
        }}
      >
        <DialogHeader>
          <DialogTitle className="pr-6 [overflow-wrap:anywhere]">{name}</DialogTitle>
          <DialogDescription>{t('profileMemory.title')}</DialogDescription>
        </DialogHeader>
        {readFailed && (
          <div className="flex flex-wrap items-center gap-2" role="alert">
            {t('learnerProfiles.unavailable')}
            <Button variant="outline" size="sm" onClick={reload}>
              {t('common.retry')}
            </Button>
          </div>
        )}
        {!view && !readFailed && <p role="status">{t('common.loading')}</p>}
        {view?.maintenance.pending && (
          <p role="status" className="text-sm text-muted-foreground">
            {t('profileMemory.pending')}
          </p>
        )}
        {view?.maintenance.failed && (
          <p role="status" className="text-sm text-muted-foreground">
            {t('profileMemory.maintenanceFailed')}
          </p>
        )}
        {view &&
          (draft ? (
            <form onSubmit={save} className="grid gap-3">
              <label className="grid gap-1 text-sm font-medium">
                {t('learnerProfiles.nameLabel')}
                <Input
                  value={draft.name}
                  maxLength={LEARNER_PROFILE_NAME_MAX}
                  required
                  disabled={saving}
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                />
              </label>
              {PERSONAL_FIELDS.map((field) => (
                <label key={field} className="grid gap-1 text-sm font-medium">
                  {t(`profileMemory.editFields.${field}`)}
                  <Textarea
                    value={draft[field]}
                    rows={2}
                    maxLength={PROFILE_MEMORY_FIELDS_MAX}
                    disabled={saving}
                    onChange={(event) => setDraft({ ...draft, [field]: event.target.value })}
                  />
                </label>
              ))}
              {saveError && (
                <p className="text-sm text-destructive" role="alert">
                  {t(`profileMemory.${saveError}`)}
                </p>
              )}
              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={saving}
                  onClick={() => setDraft(undefined)}
                >
                  {t('common.cancel')}
                </Button>
                <Button
                  type="submit"
                  disabled={saving || !draft.name.trim() || saveError === 'conflict'}
                >
                  {t('profileMemory.save')}
                </Button>
              </div>
            </form>
          ) : (
            <>
              <div className="flex flex-wrap justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={reload}>
                  {t('profileMemory.refresh')}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setSaveError(undefined);
                    setDraft({ ...view.fields, name: view.profile.name ?? '' });
                  }}
                >
                  {t('profileMemory.edit')}
                </Button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {PROFILE_MEMORY_SECTIONS.map((section) => {
                  const personal = section === 'experiences' ? '' : view.fields[section];
                  const items = view.items.filter((item) => item.section === section);
                  return (
                    <section
                      key={section}
                      className="min-w-0 space-y-2 rounded-xl border bg-muted/25 p-3"
                    >
                      <h3 className="text-sm font-semibold">
                        {t(`profileMemory.sections.${section}`)}
                      </h3>
                      {personal && (
                        <div className="space-y-1">
                          <p className="text-xs text-muted-foreground">
                            {t('profileMemory.personal')}
                          </p>
                          <p className="whitespace-pre-wrap text-sm [overflow-wrap:anywhere]">
                            {personal}
                          </p>
                        </div>
                      )}
                      {!personal && !items.length && (
                        <p className="text-sm text-muted-foreground">{t('profileMemory.empty')}</p>
                      )}
                      {items.map((item) => (
                        <MemoryItem
                          endpoint={endpoint}
                          item={item}
                          key={item.id}
                          onFlag={() =>
                            setView(
                              (current) =>
                                current && {
                                  ...current,
                                  items: current.items.map((entry) =>
                                    entry.id === item.id ? { ...entry, flagged: true } : entry,
                                  ),
                                },
                            )
                          }
                        />
                      ))}
                    </section>
                  );
                })}
              </div>
            </>
          ))}
      </DialogContent>
    </Dialog>
  );
}

function MemoryItem({
  endpoint,
  item,
  onFlag,
}: {
  endpoint: string;
  item: ProfileMemoryItem;
  onFlag: () => void;
}) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const [basis, setBasis] = useState<ProfileMemorySource | null>();
  const [sourceError, setSourceError] = useState(false);
  const [flagError, setFlagError] = useState(false);
  const [flagging, setFlagging] = useState(false);
  const url = `${endpoint}/${encodeURIComponent(item.id)}`;
  async function load() {
    setBasis(undefined);
    setSourceError(false);
    try {
      const reply = await fetch(url, { cache: 'no-store' });
      if (reply.status === 404) setBasis(null);
      else if (reply.ok) setBasis((await reply.json()) as ProfileMemorySource);
      else throw new Error('Source unavailable');
    } catch {
      setSourceError(true);
    }
  }

  async function flag() {
    if (flagging || item.flagged) return;
    setFlagError(false);
    setFlagging(true);
    try {
      const reply = await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ flagged: true }),
      });
      if (!reply.ok) throw new Error('Report failed');
      onFlag();
    } catch {
      setFlagError(true);
    } finally {
      setFlagging(false);
    }
  }

  return (
    <article className="min-w-0 space-y-1.5 rounded-lg border bg-background p-2.5">
      <p className="text-xs text-muted-foreground">
        {t('profileMemory.system')} · {t(`profileMemory.kind.${item.kind}`)}
        {item.flagged && (
          <>
            {' '}
            · <span role="status">{t('profileMemory.flagged')}</span>
          </>
        )}
      </p>
      <p className="text-sm [overflow-wrap:anywhere]">{item.summary}</p>
      <div className="flex flex-wrap gap-1">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2"
          aria-expanded={expanded}
          onClick={() => {
            setExpanded(!expanded);
            if (!expanded) void load();
          }}
        >
          {t('profileMemory.source')}
        </Button>
        {!item.flagged && (
          <Button variant="ghost" size="sm" className="h-7 px-2" disabled={flagging} onClick={flag}>
            {t('profileMemory.flag')}
          </Button>
        )}
      </div>
      {flagError && (
        <p role="alert" className="text-xs text-destructive">
          {t('profileMemory.saveFailed')}
        </p>
      )}
      {expanded && (
        <div className="space-y-2 rounded bg-muted/60 p-2 text-xs [overflow-wrap:anywhere]">
          {sourceError && (
            <Button size="sm" variant="outline" onClick={load}>
              {t('common.retry')}
            </Button>
          )}
          {!sourceError && basis === undefined && <p role="status">{t('common.loading')}</p>}
          {basis === null && <p>{t('profileMemory.sourceUnavailable')}</p>}
          {basis && (
            <>
              <p className="font-medium">{basis.title || t(`profileMemory.kind.${basis.kind}`)}</p>
              {basis.historicalReview && (
                <p className="text-muted-foreground">{t('profileMemory.historicalReview')}</p>
              )}
              {basis.parts.map((part, index) => (
                <div className="space-y-1 border-t pt-1.5" key={index}>
                  {part.previous?.map((message, messageIndex) => (
                    <p key={messageIndex} className="whitespace-pre-wrap">
                      <strong>{t(`profileMemory.role.${message.role}`)} </strong>
                      {message.text}
                    </p>
                  ))}
                  {part.question && <p className="whitespace-pre-wrap">{part.question}</p>}
                  {!!part.options?.length && (
                    <ul className="list-inside list-disc">
                      {part.options.map((option, optionIndex) => (
                        <li key={optionIndex}>{option}</li>
                      ))}
                    </ul>
                  )}
                  <p className="whitespace-pre-wrap">
                    <strong>{t('profileMemory.answer')} </strong>
                    {part.answer}
                  </p>
                  {part.review && <p>{t(`profileMemory.review.${part.review}`)}</p>}
                  <p className="text-muted-foreground">{t(`profileMemory.help.${part.help}`)}</p>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </article>
  );
}
