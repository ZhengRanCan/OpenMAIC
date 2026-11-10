'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useI18n } from '@/lib/hooks/use-i18n';
import type { QuizFeedbackLocator } from '@/lib/quiz/feedback';
import {
  QUIZ_PRACTICE_HELP_EVENT,
  type QuizPracticeHelpRequest,
  type QuizPracticeStatus,
} from '@/lib/quiz/practice';
import { createQuizOperationId, saveQuizDraft } from '@/lib/quiz/trace-client';
import { Button } from '@/components/ui/button';

type Ready = Extract<QuizPracticeStatus, { status: 'ready' }>;

export function QuizPracticeCard({
  locator,
  renderQuestion,
}: {
  locator: QuizFeedbackLocator;
  renderQuestion: (value: Ready, locked: boolean, onChange: (choice: string) => void) => ReactNode;
}) {
  const { locale, t } = useI18n();
  const [result, setResult] = useState<QuizPracticeStatus>({ status: 'disabled' });
  const [closed, setClosed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const actionInProgress = useRef(false);
  const { attemptId, versionId, submissionId, reviewId } = locator;
  const ids = { attemptId, versionId, submissionId, reviewId };
  const url = '/api/quiz-practice';
  const read = useCallback(
    async (signal?: AbortSignal): Promise<QuizPracticeStatus> => {
      const query = new URLSearchParams({ attemptId, versionId, submissionId, reviewId });
      const reply = await fetch(`${url}?${query}`, { cache: 'no-store', signal });
      if ([403, 404, 409].includes(reply.status)) return { status: 'disabled' };
      if (!reply.ok) throw new Error('PRACTICE_READ_FAILED');
      return reply.json();
    },
    [attemptId, versionId, submissionId, reviewId],
  );
  const post = async <T,>(body: Record<string, unknown>): Promise<T> => {
    const reply = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...ids, ...body }),
    });
    if (!reply.ok) throw new Error('PRACTICE_ACTION_FAILED');
    return reply.json();
  };

  useEffect(() => {
    const controller = new AbortController();
    void read(controller.signal).then(
      (next) => {
        if (!controller.signal.aborted) setResult(next);
      },
      () => {
        if (!controller.signal.aborted) setResult({ status: 'unknown' });
      },
    );
    return () => controller.abort();
  }, [read]);

  useEffect(() => {
    if (result.status !== 'pending' || busy) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void read(controller.signal).then(
        (next) => {
          if (!controller.signal.aborted) setResult(next);
        },
        () => {
          if (!controller.signal.aborted) setResult({ status: 'unknown' });
        },
      );
    }, 2000);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  });

  async function run(action: () => Promise<void>) {
    if (actionInProgress.current) return;
    actionInProgress.current = true;
    setBusy(true);
    setError(false);
    try {
      await action();
    } catch {
      setError(true);
      try {
        setResult(await read());
      } catch {
        setResult({ status: 'unknown' });
      }
    } finally {
      actionInProgress.current = false;
      setBusy(false);
    }
  }

  if (result.status === 'disabled') return null;
  if (closed)
    return (
      <Button variant="outline" size="sm" onClick={() => setClosed(false)}>
        {t('quiz.practiceResume')}
      </Button>
    );
  const accept = (retryToken?: string) =>
    void run(async () => {
      setResult({ status: 'pending' });
      setResult(await post({ action: 'accept', language: locale, retryToken }));
    });
  return (
    <section aria-label={t('quiz.practiceTitle')} className="space-y-3 rounded-lg border p-3">
      <h4 className="font-semibold">{t('quiz.practiceTitle')}</h4>
      {error && <p role="status">{t('quiz.practiceError')}</p>}
      {result.status === 'idle' && (
        <Button size="sm" disabled={busy} onClick={() => accept()}>
          {t('quiz.practiceStart')}
        </Button>
      )}
      {result.status === 'pending' && <p role="status">{t('quiz.practicePending')}</p>}
      {result.status === 'unknown' && (
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => void run(async () => setResult(await read()))}
        >
          {t('quiz.practiceCheck')}
        </Button>
      )}
      {result.status === 'failed' && (
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => accept(result.retryToken)}
        >
          {t('quiz.practiceRetry')}
        </Button>
      )}
      {result.status === 'ready' && (
        <>
          {renderQuestion(
            result,
            busy || result.submitted,
            (choice) =>
              void run(async () => {
                await saveQuizDraft(result.attemptId, {
                  operationId: createQuizOperationId(),
                  expectedLastSeq: result.lastSeq,
                  answers: { [result.question.id]: choice },
                });
                setResult(await read());
              }),
          )}
          {result.helpRequested && (
            <p className="text-muted-foreground">{t('quiz.practiceHelpRequested')}</p>
          )}
          {!result.review && (
            <Button
              size="sm"
              disabled={busy || !result.choice}
              onClick={() =>
                void run(async () => {
                  setResult(await post({ action: 'submit', choice: result.choice }));
                })
              }
            >
              {t(result.submitted ? 'quiz.practiceFinishReview' : 'quiz.practiceSubmit')}
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const help = await post<QuizPracticeHelpRequest>({
                  action: 'help',
                  helpId: createQuizOperationId(),
                });
                window.dispatchEvent(new CustomEvent(QUIZ_PRACTICE_HELP_EVENT, { detail: help }));
                setResult(await read());
              })
            }
          >
            {t('quiz.practiceAsk')}
          </Button>
        </>
      )}
      <Button size="sm" variant="ghost" onClick={() => setClosed(true)}>
        {t(result.status === 'idle' ? 'quiz.practiceSkip' : 'quiz.practiceReturn')}
      </Button>
    </section>
  );
}
