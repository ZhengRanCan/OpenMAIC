import { z } from 'zod';
import type { Queryable } from '@openmaic/storage/document/pg';
import type { MemoryScope, MemorySource, CapturedMemoryReply } from './contracts';
import type { DialogueModelIdentity } from '@/lib/dialogue/evidence-contracts';

export const DIALOGUE_MEMORY_VERSION = 'dialogue-memory.v1';
export const DIALOGUE_MEMORY_LIMITS = {
  maxOutputTokens: 8192,
  timeoutMs: 180000,
  leaseMs: 300000,
  requestBytes: 16384,
} as const;
export class DialogueMemoryError extends Error {
  constructor(
    readonly code: string,
    readonly status = 409,
  ) {
    super(code);
    this.name = 'DialogueMemoryError';
  }
}
const id = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[\w:-]+$/);
export const deliveryRequestSchema = z.strictObject({ operationId: id, evidenceRunId: id });
export type DeliveryRequest = z.infer<typeof deliveryRequestSchema>;
export const deliveryRecoverySchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('finalize_saved_reply'), operationId: id }),
  z.strictObject({ action: z.literal('retry_deferred'), operationId: id }),
  z.strictObject({
    action: z.literal('confirm_paid_retry'),
    operationId: id,
    acknowledgeAdditionalCall: z.literal(true),
    acknowledgeUnknownCost: z.boolean().optional(),
  }),
]);
export type DeliveryRecovery = z.infer<typeof deliveryRecoverySchema>;
export type DialogueSourceAuthority = (
  scope: MemoryScope,
  source: MemorySource,
  tx: Queryable,
) => Promise<string | null>;
export interface DialogueMemorySourceRecord {
  id: string;
  ownerId: string;
  student: 'A' | 'B' | 'C';
  environmentId: string;
  stageId: string;
  chatSessionId: string;
  evidenceRunId: string;
  factId: string;
  bindingDigest: string;
  source: MemorySource;
}
export type DeliveryState =
  | 'prepared'
  | 'updating'
  | 'completed'
  | 'deferred'
  | 'empty'
  | 'failed'
  | 'unknown'
  | 'blocked'
  | 'revoked';
export interface DialogueMemoryDelivery {
  id: string;
  ownerId: string;
  stageId: string;
  evidenceRunId: string;
  student: 'A' | 'B' | 'C';
  environmentId: string;
  state: DeliveryState;
  reason: string | null;
  sources: MemorySource[];
  model: DialogueModelIdentity;
  memoryRunId: string;
  retryOf: string | null;
  leaseExpiresAt: string | null;
  token: string | null;
  memoryClaimToken: string | null;
  reply: CapturedMemoryReply | null;
  createdAt: string;
}
