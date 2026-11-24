'use client';

import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import type { LearningFeatureStatuses } from '@/app/api/learning-feature-status/route';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/lib/hooks/use-i18n';

const features = [
  'automaticMastery',
  'quizFeedback',
  'quizPractice',
  'dialogueLearnerContext',
] as const satisfies readonly (keyof LearningFeatureStatuses)[];

export function LearningFeatureStatus() {
  const { t } = useI18n();
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{
    attempt: number;
    statuses: LearningFeatureStatuses | null;
  }>();
  const statuses = result?.attempt === attempt ? result.statuses : undefined;

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch('/api/learning-feature-status', {
          cache: 'no-store',
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]),
        });
        if (!response.ok) throw new Error('Learning feature status unavailable');
        const statuses: LearningFeatureStatuses = await response.json();
        if (!controller.signal.aborted) setResult({ attempt, statuses });
      } catch {
        if (!controller.signal.aborted) setResult({ attempt, statuses: null });
      }
    })();
    return () => controller.abort();
  }, [attempt]);

  return (
    <section aria-labelledby="learning-feature-status-title" className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 id="learning-feature-status-title" className="text-sm font-semibold">
          {t('settings.learningStatus.title')}
        </h3>
        <Button
          variant="outline"
          size="sm"
          disabled={statuses === undefined}
          onClick={() => setAttempt((previous) => previous + 1)}
        >
          <RefreshCw className="size-3.5" aria-hidden="true" />
          {t('settings.usage.refresh')}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{t('settings.learningStatus.description')}</p>
      {statuses === undefined ? (
        <p role="status" className="text-sm text-muted-foreground">
          {t('settings.learningStatus.loading')}
        </p>
      ) : statuses === null ? (
        <p role="alert" className="text-sm text-destructive">
          {t('settings.learningStatus.failed')}
        </p>
      ) : (
        <dl className="grid gap-2 sm:grid-cols-2">
          {features.map((feature) => (
            <div
              key={feature}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm"
            >
              <dt>{t(`settings.learningStatus.${feature}`)}</dt>
              <dd>
                <Badge variant={statuses[feature] === 'enabled' ? 'default' : 'secondary'}>
                  {t(`settings.learningStatus.${statuses[feature]}`)}
                </Badge>
              </dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
