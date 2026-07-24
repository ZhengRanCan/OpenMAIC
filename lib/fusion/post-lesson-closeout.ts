import { createProfileUpdateCandidate } from './profile-update-candidate';
import type { ClassroomObservationLedger } from './classroom-observation-ledger';
import type { FusionOutboxStore } from './outbox/store';

export type CloseoutStatus = 'queued' | 'save_failed' | 'retry_scheduled' | 'dead_letter' | 'received' | 'duplicate';
export interface CloseoutSummary { immediateConclusion: 'classroom_completed'; deliveryStatus: CloseoutStatus; reasonCode?: string; longTermProfileStatus: 'not_confirmed'; }
export function completeLesson(ledger: ClassroomObservationLedger, outbox: FusionOutboxStore): CloseoutSummary {
  try { const candidate = createProfileUpdateCandidate(ledger); const queued = outbox.enqueue(candidate); return { immediateConclusion: 'classroom_completed', deliveryStatus: queued ? 'queued' : 'duplicate', longTermProfileStatus: 'not_confirmed' }; }
  catch { return { immediateConclusion: 'classroom_completed', deliveryStatus: 'save_failed', reasonCode: 'candidate_or_outbox_unavailable', longTermProfileStatus: 'not_confirmed' }; }
}
export function summarizeDelivery(status: string, reasonCode?: string): CloseoutSummary { const deliveryStatus: CloseoutStatus = status === 'delivered' ? 'received' : status === 'retry_scheduled' ? 'retry_scheduled' : status === 'dead_letter' ? 'dead_letter' : 'save_failed'; return { immediateConclusion: 'classroom_completed', deliveryStatus, ...(reasonCode ? { reasonCode } : {}), longTermProfileStatus: 'not_confirmed' }; }
