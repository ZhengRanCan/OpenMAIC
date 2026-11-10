'use client';

import { useEffect, useState } from 'react';
import { useI18n } from '@/lib/hooks/use-i18n';
import type { QuizFeedbackLocator, QuizFeedbackStatus } from '@/lib/quiz/feedback';

export function QuizFeedbackCard({
  attemptId,
  versionId,
  submissionId,
  reviewId,
}: QuizFeedbackLocator) {
  const { t, locale } = useI18n();
  const [result, setResult] = useState<QuizFeedbackStatus>({ status: 'disabled' });
  const [action, setAction] = useState<{ revision: number; retryToken?: string }>({ revision: 0 });
  useEffect(() => {
    const controller = new AbortController();
    const ids = { attemptId, versionId, submissionId, reviewId };
    const url = '/api/quiz-feedback';
    let timer: ReturnType<typeof setTimeout> | undefined;
    const fetchStatus = async (post: boolean, retryToken?: string): Promise<QuizFeedbackStatus> => {
      const response = await (post
        ? fetch(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ ...ids, language: locale, retryToken }),
            signal: controller.signal,
          })
        : fetch(`${url}?${new URLSearchParams(ids)}`, {
            signal: controller.signal,
            cache: 'no-store',
          }));
      if (response.status === 404 || response.status === 409) return { status: 'disabled' };
      if (!response.ok) return { status: 'unknown' };
      return response.json();
    };
    const load = async (start: boolean, retryToken?: string) => {
      try {
        let next = await fetchStatus(Boolean(retryToken), retryToken);
        if (controller.signal.aborted) return;
        if (start && next.status === 'idle') {
          setResult({ status: 'pending' });
          next = await fetchStatus(true);
        }
        if (controller.signal.aborted) return;
        setResult(next);
        if (next.status === 'pending') timer = setTimeout(() => void load(false), 2000);
      } catch {
        if (!controller.signal.aborted) setResult({ status: 'unknown' });
      }
    };
    void load(action.revision === 0, action.retryToken);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [attemptId, versionId, submissionId, reviewId, locale, action]);

  if (result.status === 'disabled' || result.status === 'idle') return null;
  return (
    <section
      aria-label={t('quiz.feedbackTitle')}
      className="space-y-2 rounded-xl border p-4 text-sm"
    >
      <h3 className="font-semibold">{t('quiz.feedbackTitle')}</h3>
      {result.status === 'ready' ? (
        <div className="space-y-2 break-words">
          {result.partial && <p className="text-muted-foreground">{t('quiz.feedbackPartial')}</p>}
          <p>{result.feedback.summary}</p>
          {result.feedback.practiceDirection && (
            <p>
              <strong>{t('quiz.feedbackPractice')} </strong>
              {result.feedback.practiceDirection}
            </p>
          )}
        </div>
      ) : (
        <p role="status">
          {t(
            `quiz.${
              {
                pending: 'feedbackPending',
                failed: 'feedbackFailed',
                unknown: 'feedbackUnknown',
                currentOnly: 'feedbackCurrentOnly',
              }[result.status]
            }`,
          )}
        </p>
      )}
      {(result.status === 'failed' || result.status === 'unknown') && (
        <button
          type="button"
          className="rounded underline focus-visible:outline focus-visible:outline-2"
          onClick={() => {
            const retryToken = result.status === 'failed' ? result.retryToken : undefined;
            setResult({ status: 'pending' });
            setAction(({ revision }) => ({ revision: revision + 1, retryToken }));
          }}
        >
          {t(result.status === 'failed' ? 'quiz.feedbackRetry' : 'quiz.feedbackCheck')}
        </button>
      )}
    </section>
  );
}
