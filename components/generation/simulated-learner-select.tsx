'use client';

import { useId } from 'react';

import { useI18n } from '@/lib/hooks/use-i18n';

export type SimulatedLearnerChoice = '' | 'A' | 'B' | 'C';

/** Shared artificial Memory data, selected only for a plain classic run. */
export function SimulatedLearnerSelect({
  value,
  onChange,
  unsupported,
  disabled,
}: {
  value: SimulatedLearnerChoice;
  onChange: (value: SimulatedLearnerChoice) => void;
  unsupported: boolean;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const id = useId();
  return (
    <div className="px-4 pb-3 space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={id} className="text-xs font-medium">
          {t('generation.simulatedLearnerLabel')}
        </label>
        <select
          id={id}
          value={value}
          onChange={(event) => {
            const next = event.target.value;
            if (next === '' || next === 'A' || next === 'B' || next === 'C') onChange(next);
          }}
          disabled={disabled || unsupported}
          aria-describedby={`${id}-hint`}
          className="rounded-md border border-input bg-background px-2 py-1.5 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
        >
          <option value="">{t('generation.simulatedLearnerNone')}</option>
          {(['A', 'B', 'C'] as const).map((learner) => (
            <option key={learner} value={learner}>
              {t('generation.simulatedLearnerOption', { learner })}
            </option>
          ))}
        </select>
      </div>
      <p id={`${id}-hint`} className="text-xs text-muted-foreground" role="status">
        {t(
          unsupported
            ? 'generation.simulatedLearnerUnsupported'
            : 'generation.simulatedLearnerHint',
        )}
      </p>
    </div>
  );
}
