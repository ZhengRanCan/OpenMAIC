import { z } from 'zod';
import type { DialogueSourceWindow } from './trace-types';
import type { DialogueBinding } from './evidence-contracts';

export const LOOP_VERSION = 'dialogue-learning-loop.v1';
export const LOOP_LEASE_MS = 600_000;
export const loopId = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[\w:./-]+$/);
export const learningClosureSchema = z.strictObject({
  id: loopId,
  source: z.enum([
    'manual_stop',
    'scene_switch',
    'turn_complete',
    'soft_close_confirmed',
    'soft_close_timeout',
  ]),
});
export type LearningClosure = z.infer<typeof learningClosureSchema>;
export const recoverySchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('resume_saved'), operationId: loopId }),
  z.strictObject({
    action: z.enum(['retry_evidence', 'retry_memory', 'retry_deferred']),
    operationId: loopId,
    acknowledgeAdditionalCall: z.literal(true),
    acknowledgeUnknownCost: z.boolean().optional(),
  }),
]);
export type LoopRecovery = z.infer<typeof recoverySchema>;
export type LoopState =
  | 'queued'
  | 'running'
  | 'waiting'
  | 'failed'
  | 'unknown'
  | 'completed'
  | 'revoked'
  | 'not_eligible'
  | 'blocked';
export interface DialogueLoopJob {
  id: string;
  ownerId: string;
  stageId: string;
  chatSessionId: string;
  key: string;
  state: LoopState;
  reason: string | null;
  snapshot: DialogueSourceWindow | null;
  binding: DialogueBinding | null;
  closure: LearningClosure;
  configDigest: string;
  modelDigest?: string;
  evidenceRunId: string | null;
  memoryDeliveryId: string | null;
  blockingDeliveryId: string | null;
  blockingRetryAuthorized?: boolean;
  evidenceState: string;
  memoryState: string;
  token: string | null;
  leaseExpiresAt: string | null;
  createdAt: string;
}
export interface DialogueLoopStatus {
  id: string;
  stageId: string;
  chatSessionId: string;
  contentDigest: string | null;
  state: LoopState;
  reason: string | null;
  evidenceState: string;
  memoryState: string;
  blockingDeliveryId: string | null;
}
export function projectLoopStatus(job: DialogueLoopJob): DialogueLoopStatus {
  return {
    id: job.id,
    stageId: job.stageId,
    chatSessionId: job.chatSessionId,
    contentDigest: job.snapshot?.contentDigest ?? null,
    state: job.state,
    reason: job.reason,
    evidenceState: job.evidenceState,
    memoryState: job.memoryState,
    blockingDeliveryId: job.blockingDeliveryId,
  };
}
export class DialogueLoopError extends Error {
  constructor(
    readonly code: string,
    readonly status = 409,
  ) {
    super(code);
    this.name = 'DialogueLoopError';
  }
}
