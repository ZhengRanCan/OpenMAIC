'use client';

import { useCallback, useEffect, useState } from 'react';
import { useI18n } from '@/lib/hooks/use-i18n';

type JobState = 'queued' | 'running' | 'completed' | 'failed' | 'unknown';
type Status = JobState | 'waiting' | 'unavailable' | null;

/** The score stays available independently of background memory processing. */
export function QuizLearningStatus({ attemptId }: { attemptId: string }) {
  const { t } = useI18n();
  const [status, setStatus] = useState<Status>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const endpoint = `/api/quiz-learning-loop/${encodeURIComponent(attemptId)}`;

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    setStatus(null);
    async function read() {
      try {
        const response = await fetch(endpoint, { signal: controller.signal, cache: 'no-store' });
        if (cancelled) return;
        if (response.status === 204) return;
        if (response.status === 404) {
          setStatus('waiting');
          timer = setTimeout(read, 10000);
          return;
        }
        if (!response.ok) throw new Error('status unavailable');
        const body: { job?: { state?: string } } = await response.json();
        const state = body.job?.state;
        if (!state || !['queued', 'running', 'completed', 'failed', 'unknown'].includes(state))
          throw new Error('invalid status');
        setStatus(state as JobState);
        if (state === 'queued' || state === 'running') timer = setTimeout(read, 5000);
      } catch {
        if (!cancelled) setStatus('unavailable');
      }
    }
    void read();
    return () => {
      cancelled = true;
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [endpoint, refresh]);

  const retry = useCallback(async () => {
    if (busy) return;
    if (status === 'unknown' && !window.confirm(t('quiz.learningUnknownConfirm'))) return;
    setBusy(true);
    setError(false);
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'retry',
          ...(status === 'unknown' ? { confirmUnknown: true } : {}),
        }),
      });
      if (!response.ok) throw new Error('retry unavailable');
      setRefresh((value) => value + 1);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }, [busy, endpoint, status, t]);

  if (status === null) return null;
  const key =
    status === 'completed'
      ? 'quiz.learningCompleted'
      : status === 'failed'
        ? 'quiz.learningFailed'
        : status === 'unknown'
          ? 'quiz.learningUnknown'
          : status === 'unavailable'
            ? 'quiz.learningUnavailable'
            : 'quiz.learningProcessing';
  return (
    <div className="rounded-xl border p-3 space-y-2 text-sm" data-testid="quiz-learning-status">
      <p role="status">{t(key)}</p>
      {(status === 'failed' || status === 'unknown') && (
        <button type="button" className="underline" disabled={busy} onClick={() => void retry()}>
          {t('quiz.learningRetry')}
        </button>
      )}
      {status === 'unavailable' && (
        <button
          type="button"
          className="underline"
          onClick={() => setRefresh((value) => value + 1)}
        >
          {t('quiz.learningRefresh')}
        </button>
      )}
      {error && <p role="alert">{t('quiz.learningRetryUnavailable')}</p>}
    </div>
  );
}
