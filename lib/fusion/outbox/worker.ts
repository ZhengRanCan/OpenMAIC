import type { FusionOutboxStore } from './store';
export interface CandidateSubmitter { submit(candidate: unknown): Promise<{ status: string; reasonCode?: string }>; }
export async function processOne(store: FusionOutboxStore, submitter: CandidateSubmitter): Promise<void> { const record = store.acquire(); if (!record) return; try { store.complete(record.candidate.idempotencyKey, await submitter.submit(record.candidate)); } catch { store.complete(record.candidate.idempotencyKey, { status: 'retryable_failure', reasonCode: 'submission_unavailable' }); } }
