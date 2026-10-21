import { randomUUID } from 'node:crypto';
import { traceFixture } from './quiz-trace-fixture';
import { ensureQuizEvidenceSchema } from '@/lib/persistence/quiz-evidence-schema';
import { readPreparedIn } from '@/lib/persistence/quiz-trace';
import { provenanceFingerprint, evidenceDigest } from '@/lib/evidence/context';
import {
  EVIDENCE_LIMITS,
  EVIDENCE_PROMPT_VERSION,
  EVIDENCE_SCHEMA_VERSION,
  EVIDENCE_CONTEXT_VERSION,
  type EvidenceSettings,
  type EvidenceModelIdentity,
  type OrganizeEvidenceRequest,
} from '@/lib/evidence/contracts';
import type { PreparedQuiz } from '@/lib/quiz/trace-types';

export async function evidenceFixture(pgUrl?: string) {
  const f = await traceFixture(pgUrl);
  await ensureQuizEvidenceSchema(f.db);
  const prepared = await f.prepare();
  await f.service.submit('learner', prepared.attemptId, {
    operationId: 'submit',
    submissionId: 'submission',
    answers: { q: 'A' },
  });
  const source = await readPreparedIn(f.db, 'learner', prepared.attemptId);
  return { ...f, source, ...evidenceInputs(source) };
}
export function evidenceInputs(source: PreparedQuiz) {
  const submissionId = source.submission!.id;
  const provenance = {
    version: 1 as const,
    sources: [
      {
        stageId: source.stageId,
        sceneId: source.sceneId,
        attemptId: source.attemptId,
        versionId: source.version.id,
        submissionId,
        sourceFingerprint: provenanceFingerprint(source),
        conditions: [
          'controlled-proxy' as const,
          'reference-access-before-submit' as const,
          'not-personal-learner-evidence' as const,
        ],
      },
    ],
  };
  const settings: EvidenceSettings = {
    enabled: true,
    provenance,
    provenanceDigest: evidenceDigest(provenance),
    maxOutputTokens: EVIDENCE_LIMITS.maxOutputTokens,
    timeoutMs: EVIDENCE_LIMITS.timeoutMs,
    leaseMs: EVIDENCE_LIMITS.leaseMs,
    promptVersion: EVIDENCE_PROMPT_VERSION,
    schemaVersion: EVIDENCE_SCHEMA_VERSION,
    contextVersion: EVIDENCE_CONTEXT_VERSION,
  };
  const model: EvidenceModelIdentity = {
    provider: 'synthetic',
    model: 'test',
    slot: 'classroom',
    endpointFingerprint: 'test-endpoint',
    thinking: null,
    maxOutputTokens: settings.maxOutputTokens,
    timeoutMs: settings.timeoutMs,
    promptVersion: settings.promptVersion,
    schemaVersion: settings.schemaVersion,
    contextVersion: settings.contextVersion,
  };
  const request = (overrides: Partial<OrganizeEvidenceRequest> = {}): OrganizeEvidenceRequest => ({
    operationId: randomUUID(),
    stageId: source.stageId,
    anchor: { attemptId: source.attemptId, submissionId },
    related: [],
    language: 'zh-CN',
    action: 'reuse-or-create',
    ...overrides,
  });
  return { settings, model, request };
}
