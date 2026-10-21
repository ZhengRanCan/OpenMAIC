import { z } from 'zod';
import type { PreparedQuiz } from '@/lib/quiz/trace-types';

export const EVIDENCE_SCHEMA_VERSION = 'quiz-evidence.v1' as const;
export const EVIDENCE_CONTEXT_VERSION = 'quiz-evidence-context.v1' as const;
export const EVIDENCE_PROMPT_VERSION = 'quiz-evidence-prompt.v1' as const;
export const EVIDENCE_LIMITS = {
  requestBytes: 16 * 1024,
  inputBytes: 128 * 1024,
  outputBytes: 128 * 1024,
  questions: 20,
  maxOutputTokens: 16000,
  timeoutMs: 180000,
  leaseMs: 240000,
} as const;
export class EvidenceError extends Error {
  constructor(
    readonly code: string,
    readonly status = 409,
  ) {
    super(code);
    this.name = 'EvidenceError';
  }
}
export const evidenceIdSchema = z.string().regex(/^[A-Za-z0-9_.:-]{1,160}$/);
export const submissionRefSchema = z.strictObject({
  attemptId: evidenceIdSchema,
  submissionId: evidenceIdSchema,
});
export const organizeEvidenceRequestSchema = z
  .strictObject({
    operationId: z.uuid(),
    stageId: evidenceIdSchema,
    anchor: submissionRefSchema,
    related: z.array(submissionRefSchema).max(1),
    language: z.enum(['zh-CN', 'en-US']),
    action: z.enum(['reuse-or-create', 'reanalyze']),
    previousRunId: evidenceIdSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if ((value.action === 'reanalyze') !== Boolean(value.previousRunId))
      ctx.addIssue({ code: 'custom', message: 'previousRunId required only for reanalyze' });
    const refs = [value.anchor, ...value.related];
    if (
      new Set(refs.map((x) => x.attemptId)).size !== refs.length ||
      new Set(refs.map((x) => x.submissionId)).size !== refs.length
    )
      ctx.addIssue({ code: 'custom', message: 'Duplicate submission source' });
  });
export type SubmissionRef = z.infer<typeof submissionRefSchema>;
export type OrganizeEvidenceRequest = z.infer<typeof organizeEvidenceRequestSchema>;
export function parseOrganizeRequest(value: unknown): OrganizeEvidenceRequest {
  const result = organizeEvidenceRequestSchema.safeParse(value);
  if (!result.success) throw new EvidenceError('INVALID_EVIDENCE_REQUEST', 400);
  return result.data;
}
export const conditionCodeSchema = z.enum([
  'controlled-proxy',
  'reference-access-before-submit',
  'not-personal-learner-evidence',
]);
export type EvidenceConditionCode = z.infer<typeof conditionCodeSchema>;
export interface ConfirmedCondition {
  code: EvidenceConditionCode;
  submissionId: string;
  sourceFingerprint: string;
  origin: 'f63-review';
}
export interface EvidenceProvenanceSource {
  stageId: string;
  sceneId: string;
  attemptId: string;
  versionId: string;
  submissionId: string;
  sourceFingerprint: string;
  conditions: EvidenceConditionCode[];
}
export interface EvidenceProvenanceManifest {
  version: 1;
  sources: EvidenceProvenanceSource[];
}
export interface EvidenceSettings {
  enabled: true;
  provenance: EvidenceProvenanceManifest;
  provenanceDigest: string;
  maxOutputTokens: number;
  timeoutMs: number;
  leaseMs: number;
  promptVersion: string;
  schemaVersion: typeof EVIDENCE_SCHEMA_VERSION;
  contextVersion: typeof EVIDENCE_CONTEXT_VERSION;
}
export interface EvidenceSourceEnvelope {
  schemaVersion: 1;
  capturedAt: string;
  anchor: PreparedQuiz;
  related: PreparedQuiz[];
  conditions: ConfirmedCondition[];
  provenanceDigest: string;
}
export type EvidenceSourceRole =
  | 'task'
  | 'answer'
  | 'rubric'
  | 'review'
  | 'planning'
  | 'resource'
  | 'condition'
  | 'version';
export interface EvidenceSourceScope {
  stageId: string;
  sceneId: string;
  versionId: string;
  attemptId?: string;
  submissionId?: string;
  questionId?: string;
  reviewId?: string;
  taskDigest?: string;
}
export interface EvidenceSourceCard {
  ref: string;
  role: EvidenceSourceRole;
  scope: EvidenceSourceScope;
  path: string;
  contentDigest: string;
  renderedText: string;
  condition?: ConfirmedCondition;
}
export interface EvidenceContext {
  version: typeof EVIDENCE_CONTEXT_VERSION;
  text: string;
  sourceIndex: Record<string, EvidenceSourceCard>;
  digest: string;
}
export interface EvidenceModelIdentity {
  provider: string;
  model: string;
  slot: 'classroom';
  endpointFingerprint: string;
  thinking: unknown;
  maxOutputTokens: number;
  timeoutMs: number;
  promptVersion: string;
  schemaVersion: typeof EVIDENCE_SCHEMA_VERSION;
  contextVersion: typeof EVIDENCE_CONTEXT_VERSION;
  configRevision?: string;
}
export interface EvidenceCapturedReply {
  text: string;
  finishReason: string;
  usage: unknown;
  receivedAt: string;
  modelIdentity: EvidenceModelIdentity;
}
export interface ModelCandidateV1 {
  topic: string;
  taskScope: string;
  observations: string[];
  interpretation: string;
  limitations: string[];
  pairs: { taskRef: string; answerRef: string }[];
  citations: { ref: string; quote?: string }[];
  conditionRefs: string[];
}
export interface ModelOutputV1 {
  schemaVersion: typeof EVIDENCE_SCHEMA_VERSION;
  overview: {
    outcome: 'formed' | 'no-new' | 'insufficient';
    inspectedRefs: string[];
    notes: string[];
    unfinished: string[];
  };
  items: ModelCandidateV1[];
}
export interface EvidenceCheckedItem extends ModelCandidateV1 {
  index: number;
  itemId?: string;
  submissionIds: string[];
  conditions: ConfirmedCondition[];
}
export interface EvidenceRejectedItem {
  index: number;
  codes: string[];
}
export interface EvidenceDeliveryCheck {
  state: 'completed' | 'partial' | 'failed';
  overview: ModelOutputV1['overview'] | null;
  items: EvidenceCheckedItem[];
  rejected: EvidenceRejectedItem[];
  errors: string[];
}
export type EvidenceRunState =
  | 'reserved'
  | 'calling'
  | 'generated'
  | 'completed'
  | 'partial'
  | 'failed'
  | 'interrupted';
export interface EvidenceRestriction {
  restrictionId: string;
  itemIds: string[];
  code: string;
  reason: string;
  sourceRefs: string[];
}
export interface EvidenceRun {
  id: string;
  stageId: string;
  state: EvidenceRunState;
  previousRunId?: string;
  sourceEnvelope: EvidenceSourceEnvelope;
  context: EvidenceContext;
  modelIdentity: EvidenceModelIdentity;
  reply?: EvidenceCapturedReply;
  delivery?: EvidenceDeliveryCheck;
  restrictions: EvidenceRestriction[];
  createdAt: string;
  updatedAt: string;
  semanticStatus: 'unreviewed';
  adoptionAllowed: false;
  request: OrganizeEvidenceRequest;
  reuseKey: string;
  prompt: { system: string; promptVersion: string; schemaVersion: typeof EVIDENCE_SCHEMA_VERSION };
  invocationToken?: string;
  leaseExpiresAt?: string;
  errorCode?: string;
}
export type EvidenceRunView =
  | (EvidenceRun & {
      visibility: 'visible';
      effectiveState: EvidenceRunState;
      sourceChanges: { code: string; sourceRefs: string[]; itemIds?: string[] }[];
    })
  | {
      runId: string;
      state: EvidenceRunState;
      visibility: 'source-unavailable' | 'source-check-unavailable';
      reasonCode: string;
      semanticStatus: 'unreviewed';
      adoptionAllowed: false;
    };
export interface EvidenceReservation {
  kind: 'existing' | 'reserved';
  run: EvidenceRun;
}
export interface EvidenceInvocationClaim {
  runId: string;
  token: string;
  leaseExpiresAt: string;
}
export const evidenceRestrictionSchema = z.strictObject({
  restrictionId: z.uuid(),
  itemIds: z.array(z.string().min(1).max(200)).max(16),
  code: evidenceIdSchema,
  reason: z.string().min(1).max(8000),
  sourceRefs: z.array(z.string().min(1).max(300)).max(128),
});
export function parseEvidenceRestriction(value: unknown): EvidenceRestriction {
  const result = evidenceRestrictionSchema.safeParse(value);
  if (!result.success) throw new EvidenceError('INVALID_EVIDENCE_RESTRICTION', 400);
  return result.data;
}
