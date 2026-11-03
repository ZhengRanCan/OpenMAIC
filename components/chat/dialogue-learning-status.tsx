'use client';
import { useEffect, useRef, useState } from 'react';
import { useI18n } from '@/lib/hooks/use-i18n';
import {
  readDialogueLearningStatus,
  recoverDialogueLearning,
} from '@/lib/dialogue/learning-loop-client';
import type { DialogueLoopStatus, LoopRecovery } from '@/lib/dialogue/learning-loop-contracts';
function phase(state: string) {
  if (['completed', 'noop'].includes(state)) return 'phaseCompleted';
  if (state === 'empty') return 'phaseEmpty';
  if (state === 'deferred') return 'phaseDeferred';
  if (['unknown', 'calling', 'updating'].includes(state))
    return state === 'unknown' ? 'phaseUnknown' : 'phaseRunning';
  if (['invalid', 'truncated', 'failed', 'blocked', 'revoked'].includes(state))
    return 'phaseFailed';
  if (state === 'waiting') return 'phaseWaiting';
  return 'phasePending';
}
export function DialogueLearningStatus({
  stageId,
  chatSessionId,
}: {
  stageId: string;
  chatSessionId: string;
}) {
  const { t } = useI18n();
  const [job, setJob] = useState<DialogueLoopStatus | null>(null),
    [hidden, setHidden] = useState(true),
    [error, setError] = useState(false),
    [busy, setBusy] = useState(false),
    [refresh, setRefresh] = useState(0);
  const generation = useRef(0),
    controller = useRef<AbortController | null>(null);
  useEffect(() => {
    const gen = ++generation.current,
      c = new AbortController();
    controller.current = c;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setJob(null);
    setError(false);
    setBusy(false);
    setHidden(true);
    async function read() {
      try {
        const value = await readDialogueLearningStatus(stageId, chatSessionId, c.signal);
        if (c.signal.aborted || generation.current !== gen) return;
        if (value === 'disabled') return;
        setHidden(false);
        setJob(value);
        setError(false);
        if (
          !value ||
          ['queued', 'running', 'waiting'].includes(value.state) ||
          value.reason === 'SOURCE_DELIVERY_PENDING'
        )
          timer = setTimeout(
            read,
            value?.state === 'running' || value?.state === 'queued' ? 5000 : 10000,
          );
      } catch {
        if (!c.signal.aborted && generation.current === gen) {
          setHidden(false);
          setError(true);
        }
      }
    }
    void read();
    return () => {
      c.abort();
      if (timer) clearTimeout(timer);
    };
  }, [stageId, chatSessionId, refresh]);
  async function recover(action: LoopRecovery['action']) {
    if (!job || busy) return;
    const gen = generation.current,
      c = controller.current;
    if (!c) return;
    if (
      action !== 'resume_saved' &&
      !window.confirm(
        t(job.state === 'unknown' ? 'chat.learning.unknownConfirm' : 'chat.learning.paidConfirm'),
      )
    )
      return;
    setBusy(true);
    setError(false);
    const operationId = crypto.randomUUID();
    const request: LoopRecovery =
      action === 'resume_saved'
        ? { action, operationId }
        : {
            action,
            operationId,
            acknowledgeAdditionalCall: true,
            ...(job.state === 'unknown' ? { acknowledgeUnknownCost: true } : {}),
          };
    try {
      await recoverDialogueLearning(job.id, request, c.signal);
      if (!c.signal.aborted && generation.current === gen) setRefresh((n) => n + 1);
    } catch {
      if (!c.signal.aborted && generation.current === gen) setError(true);
    } finally {
      if (!c.signal.aborted && generation.current === gen) setBusy(false);
    }
  }
  if (hidden) return null;
  const status = job?.state ?? 'saving';
  const canRecover = job && ['failed', 'unknown', 'blocked', 'waiting'].includes(job.state);
  const evidenceRetry =
    job && ['unknown', 'invalid', 'truncated', 'calling'].includes(job.evidenceState);
  const memoryRetry =
    job && ['unknown', 'failed', 'blocked', 'updating', 'deferred'].includes(job.memoryState);
  return (
    <div
      className="mx-2 my-2 rounded-xl border p-3 space-y-2 text-xs"
      data-testid="dialogue-learning-status"
    >
      <p role="status">{t('chat.learning.' + status)}</p>
      {job && job.state !== 'not_eligible' && (
        <p>
          {t('chat.learning.evidence')}: {t('chat.learning.' + phase(job.evidenceState))} ·{' '}
          {t('chat.learning.memory')}: {t('chat.learning.' + phase(job.memoryState))}
        </p>
      )}
      {job?.reason === 'MEMORY_PENDING_SOURCES' && <p>{t('chat.learning.dependencies')}</p>}
      <div className="flex flex-wrap gap-3">
        {canRecover && (
          <button
            type="button"
            className="underline focus-visible:outline-2"
            disabled={busy}
            onClick={() => void recover('resume_saved')}
          >
            {t('chat.learning.resume')}
          </button>
        )}
        {canRecover && (evidenceRetry || memoryRetry) && (
          <button
            type="button"
            className="underline focus-visible:outline-2"
            disabled={busy}
            onClick={() =>
              void recover(
                evidenceRetry
                  ? 'retry_evidence'
                  : job!.memoryState === 'deferred'
                    ? 'retry_deferred'
                    : 'retry_memory',
              )
            }
          >
            {t('chat.learning.retry')}
          </button>
        )}
        <button
          type="button"
          className="underline focus-visible:outline-2"
          disabled={busy}
          onClick={() => setRefresh((n) => n + 1)}
        >
          {t('chat.learning.refresh')}
        </button>
      </div>
      {error && <p role="alert">{t('chat.learning.unavailable')}</p>}
    </div>
  );
}
