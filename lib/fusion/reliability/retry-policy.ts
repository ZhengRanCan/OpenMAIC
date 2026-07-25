import type { OutboxFailureKind } from '../outbox/postgres-store';

export const MAX_OUTBOX_ATTEMPTS = 4;
export const OUTBOX_RETRY_BASE_MS = 60_000;
export const OUTBOX_RETRY_MAX_MS = 30 * 60_000;

export interface RetryableFailure {
  status?: number;
  code?: string;
  name?: string;
}

export function classifyOutboxFailure(error: RetryableFailure): OutboxFailureKind {
  if (
    error.status === 429 ||
    (error.status !== undefined && error.status >= 500 && error.status < 600)
  )
    return 'transient';
  if (
    error.code === 'ETIMEDOUT' ||
    error.code === 'ECONNRESET' ||
    error.code === 'ECONNREFUSED' ||
    error.name === 'AbortError'
  )
    return 'transient';
  return 'permanent';
}

/** 60s exponential backoff with ±20% jitter, capped at 30 minutes. */
export function nextOutboxAttempt(
  attemptCount: number,
  now = new Date(),
  random = Math.random,
): Date {
  const exponential = Math.min(
    OUTBOX_RETRY_MAX_MS,
    OUTBOX_RETRY_BASE_MS * 2 ** Math.max(0, attemptCount - 1),
  );
  const jitter = 0.8 + Math.min(1, Math.max(0, random())) * 0.4;
  return new Date(now.getTime() + Math.round(exponential * jitter));
}
