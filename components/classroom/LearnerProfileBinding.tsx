'use client';

import { useEffect, useId, useState } from 'react';
import { UserRound } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useI18n } from '@/lib/hooks/use-i18n';
import {
  LEARNER_PROFILE_NAME_MAX,
  type ClassroomLearnerProfile,
  type LearnerProfileSummary,
} from '@/lib/learner-context/learner-profile-contracts';

export function LearnerProfileBinding({
  stageId,
  complete,
}: {
  stageId: string;
  complete: boolean;
}) {
  const { t } = useI18n();
  const [binding, setBinding] = useState<ClassroomLearnerProfile | null>(null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [version, setVersion] = useState(0);
  const inputId = useId();

  useEffect(() => {
    if (!complete) return;
    const controller = new AbortController();
    void fetch(`/api/learner-profiles/classroom/${encodeURIComponent(stageId)}`, {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (response.status === 404) return;
        if (!response.ok) throw new Error('Classroom profile unavailable');
        const data = (await response.json()) as ClassroomLearnerProfile;
        if (controller.signal.aborted) return;
        setBinding(data);
        if (data.promptName) setOpen(true);
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoadFailed(true);
      });
    return () => controller.abort();
  }, [complete, stageId, version]);

  if (!binding) {
    return loadFailed ? (
      <button
        type="button"
        data-profile-controls
        title={t('learnerProfiles.unavailable')}
        className="w-fit rounded text-left text-xs text-destructive underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => {
          setLoadFailed(false);
          setVersion((n) => n + 1);
        }}
      >
        {t('learnerProfiles.unavailable')} · {t('common.retry')}
      </button>
    ) : null;
  }
  const { profile } = binding;
  const name = profile.name ?? t('learnerProfiles.unnamed');
  const label = t('learnerProfiles.bound', { name });
  if (profile.name) {
    return (
      <span className="truncate text-xs text-muted-foreground" title={label}>
        {label}
      </span>
    );
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft.trim() || saving) return;
    setSaving(true);
    setError(false);
    try {
      const response = await fetch(`/api/learner-profiles/${encodeURIComponent(profile.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: draft.trim() }),
      });
      if (response.status === 409) setVersion((n) => n + 1);
      if (!response.ok) throw new Error('Profile name could not be saved');
      const data = (await response.json()) as LearnerProfileSummary;
      setBinding({ profile: data, promptName: false });
      setOpen(false);
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!saving) setOpen(value);
      }}
    >
      <DialogTrigger asChild>
        <button
          type="button"
          data-profile-controls
          title={label}
          className="flex min-w-0 items-center gap-1 rounded text-left text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <UserRound aria-hidden="true" className="size-3 shrink-0" />
          <span className="truncate">{label}</span>
        </button>
      </DialogTrigger>
      <DialogContent
        data-profile-controls
        showCloseButton={false}
        className="max-w-[min(28rem,calc(100vw-2rem))] gap-4"
      >
        <DialogHeader>
          <DialogTitle className="text-lg">{t('learnerProfiles.nameTitle')}</DialogTitle>
          <DialogDescription>{t('learnerProfiles.nameDescription')}</DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor={inputId}>{t('learnerProfiles.nameLabel')}</label>
            <Input
              id={inputId}
              value={draft}
              required
              maxLength={LEARNER_PROFILE_NAME_MAX}
              disabled={saving}
              onChange={(event) => setDraft(event.target.value)}
            />
          </div>
          {error && (
            <p role="alert" className="text-destructive">
              {t('learnerProfiles.saveFailed')}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={saving}
              onClick={() => setOpen(false)}
            >
              {t('learnerProfiles.later')}
            </Button>
            <Button type="submit" disabled={saving || !draft.trim()}>
              {t('learnerProfiles.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
