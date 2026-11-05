import { z } from 'zod';
import type { DialogueSourceWindow } from './trace-types';

export const DIALOGUE_EVIDENCE_PROTOCOL = 'dialogue-evidence.v1';
export const DIALOGUE_CONTEXT_VERSION = 'dialogue-context.v1';
export const LEGACY_DIALOGUE_PROMPT_VERSION = 'dialogue-prompt.v1';
export const DIALOGUE_PROMPT_VERSION = 'dialogue-prompt.v2';
export const DIALOGUE_LIMITS = {
  inputBytes: 128 * 1024,
  outputBytes: 256000,
  requestBytes: 16384,
  maxFacts: 200,
  maxOutputTokens: 4096,
  timeoutMs: 120000,
  leaseMs: 180000,
} as const;
export class DialogueEvidenceError extends Error {
  constructor(
    readonly code: string,
    readonly status = 409,
  ) {
    super(code);
    this.name = 'DialogueEvidenceError';
  }
}
export const dialogueId = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[\w:./-]+$/);
export const prepareDialogueSchema = z.strictObject({
  operationId: dialogueId,
  stageId: dialogueId,
  chatSessionId: dialogueId,
});
export type PrepareDialogueRequest = z.infer<typeof prepareDialogueSchema>;
export const bindingSchema = z.strictObject({
  ownerId: dialogueId,
  stageId: dialogueId,
  chatSessionId: dialogueId,
  sourceDigest: z.string().regex(/^[a-f0-9]{64}$/),
  generationRunId: dialogueId,
  student: z.enum(['A', 'B', 'C']),
  sourceNature: z.enum(['synthetic', 'proxy']),
  conditions: z
    .array(
      z
        .string()
        .min(1)
        .max(500)
        .refine((v) => !!v.trim()),
    )
    .min(1)
    .max(16),
  memoryEnvironmentId: z.uuid(),
});
export type DialogueBinding = z.infer<typeof bindingSchema>;
export interface DialogueEvidenceSettings {
  bindings: DialogueBinding[];
  memoryEnvironmentId: string;
}
export interface DialogueFact {
  type: 'learning_performance' | 'question_help';
  evidence: string;
  refs: string[];
}
export interface DialogueReference {
  role: 'student' | 'agent' | 'unknown';
  messageId: string;
  version: string;
}
export interface DialogueEvidenceContext {
  text: string;
  sourceIndex: Record<string, DialogueReference>;
  messageVersions: Record<string, string>;
  inputDigest: string;
  inputBytes: number;
  tooLarge: boolean;
}
export interface DialogueModelIdentity {
  provider: string;
  model: string;
  endpointFingerprint: string;
  slot: 'classroom';
  thinking: unknown;
  maxOutputTokens: number;
  timeoutMs: number;
  promptVersion: string;
}
export interface DialogueCapturedReply {
  text: string;
  finishReason: string;
  usage: unknown | null;
  actualModel: string | null;
  receivedAt: string;
  durationMs: number;
}
export type DialogueRunState =
  | 'prepared'
  | 'calling'
  | 'captured'
  | 'completed'
  | 'empty'
  | 'invalid'
  | 'truncated'
  | 'unknown'
  | 'blocked'
  | 'revoked';
export interface DialogueStoredFact extends DialogueFact {
  id: string;
  fingerprint: string;
  snapshotId: string;
  messageVersions: Record<string, string>;
}
export interface DialogueEvidenceRun {
  id: string;
  ownerId: string;
  stageId: string;
  chatSessionId: string;
  reuseKey: string;
  protocol: typeof DIALOGUE_EVIDENCE_PROTOCOL;
  promptVersion: string;
  contextVersion: string;
  state: DialogueRunState;
  reason: string | null;
  createdAt: string;
  updatedAt: string;
  snapshot: DialogueSourceWindow | null;
  context: DialogueEvidenceContext | null;
  system: string;
  binding: DialogueBinding | null;
  model: DialogueModelIdentity;
  reply: DialogueCapturedReply | null;
  facts: DialogueStoredFact[];
  diagnostics: string[];
  token: string | null;
  leaseExpiresAt: string | null;
  retryOf: string | null;
}
export interface DialogueClaim {
  runId: string;
  token: string;
}
export type DialogueRecovery =
  | { action: 'resume_prepared'; operationId: string }
  | { action: 'finalize_saved_reply'; operationId: string }
  | { action: 'confirm_paid_retry'; operationId: string; acknowledgeUnknownCost: true };
export const recoverySchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('resume_prepared'), operationId: dialogueId }),
  z.strictObject({ action: z.literal('finalize_saved_reply'), operationId: dialogueId }),
  z.strictObject({
    action: z.literal('confirm_paid_retry'),
    operationId: dialogueId,
    acknowledgeUnknownCost: z.literal(true),
  }),
]);
