'use client';

import { useEffect, useId, useState } from 'react';

import { Button } from '@/components/ui/button';
import { useI18n } from '@/lib/hooks/use-i18n';
import type {
  LearnerProfileChoice,
  LearnerProfileSummary,
} from '@/lib/learner-context/learner-profile-contracts';

export function LearnerProfilePicker({
  value,
  onChange,
  supported,
  disabled,
}: {
  value: LearnerProfileChoice;
  onChange: (choice: LearnerProfileChoice) => void;
  supported: boolean;
  disabled: boolean;
}) {
  const { t } = useI18n();
  const id = useId();
  const [profiles, setProfiles] = useState<LearnerProfileSummary[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!supported) return;
    const controller = new AbortController();
    void fetch('/api/learner-profiles', { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('Learner profiles unavailable');
        return (await response.json()) as { profiles: LearnerProfileSummary[] };
      })
      .then((data) => {
        if (!controller.signal.aborted) setProfiles(data.profiles);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, [retry, supported]);

  if (!supported)
    return <p className="px-2 text-xs text-muted-foreground">{t('learnerProfiles.unsupported')}</p>;

  const choices: LearnerProfileChoice[] = [
    { mode: 'none' },
    { mode: 'blank' },
    ...(profiles ?? []).map(({ id: profileId, name }) => ({
      mode: 'existing' as const,
      profileId,
      name,
    })),
  ];
  return (
    <fieldset className="mb-3 min-w-0 space-y-1 rounded-lg border px-2 py-2" disabled={disabled}>
      <legend className="px-1 text-xs font-semibold">{t('learnerProfiles.title')}</legend>
      <div className="max-h-44 space-y-0.5 overflow-y-auto">
        {choices.map((choice) => {
          const key = choice.mode === 'existing' ? choice.profileId : choice.mode;
          const checked =
            choice.mode === 'existing'
              ? value.mode === 'existing' && value.profileId === choice.profileId
              : value.mode === choice.mode;
          return (
            <label
              key={key}
              className="flex min-w-0 cursor-pointer items-center gap-2 rounded px-1.5 py-1.5 text-sm hover:bg-muted"
            >
              <input type="radio" name={id} checked={checked} onChange={() => onChange(choice)} />
              <span className="break-words">
                {choice.mode === 'existing'
                  ? (choice.name ?? t('learnerProfiles.unnamed'))
                  : t(`learnerProfiles.${choice.mode}`)}
              </span>
            </label>
          );
        })}
      </div>
      {!profiles && (
        <div
          className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground"
          role="status"
        >
          {failed ? t('learnerProfiles.unavailable') : t('common.loading')}
          {failed && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setFailed(false);
                setRetry((n) => n + 1);
              }}
            >
              {t('common.retry')}
            </Button>
          )}
        </div>
      )}
    </fieldset>
  );
}
