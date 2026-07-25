import { DeepTutorServiceAccountClient } from '../adapter/service-account-client';
import { classifyOutboxFailure, nextOutboxAttempt } from '../reliability/retry-policy';
import type { FusionOutboxStore } from './store';
import { PgFusionOutboxStore } from './postgres-store';
export interface CandidateSubmitter {
  submit(candidate: unknown): Promise<{ status: string; reasonCode?: string }>;
}
export async function processOne(
  store: FusionOutboxStore,
  submitter: CandidateSubmitter,
): Promise<void> {
  const record = store.acquire();
  if (!record) return;
  try {
    store.complete(record.candidate.idempotencyKey, await submitter.submit(record.candidate));
  } catch {
    store.complete(record.candidate.idempotencyKey, {
      status: 'retryable_failure',
      reasonCode: 'submission_unavailable',
    });
  }
}

/** Production worker path: it deliberately uses a service account, never a classroom delegation token. */
export async function processOnePostgres(
  store: PgFusionOutboxStore,
  workerId: string,
  client: DeepTutorServiceAccountClient,
  leaseMs = 60_000,
  now = new Date(),
): Promise<void> {
  const message = await store.acquire(workerId, leaseMs, now);
  if (!message) return;
  try {
    await store.complete(message, await client.submit(message), undefined, undefined, now);
  } catch (error) {
    const failure = classifyOutboxFailure(
      error instanceof Error ? (error as Error & { status?: number; code?: string }) : {},
    );
    const reasonCode = failure === 'transient' ? 'submission_unavailable' : 'submission_rejected';
    await store.complete(
      message,
      { status: failure === 'transient' ? 'queued' : 'rejected', reasonCode },
      failure,
      failure === 'transient' ? nextOutboxAttempt(message.attemptCount, now) : undefined,
      now,
    );
  }
}
