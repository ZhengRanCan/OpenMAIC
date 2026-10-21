import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import type { PreparedQuiz } from '@/lib/quiz/trace-types';
import {
  EVIDENCE_CONTEXT_VERSION,
  EVIDENCE_LIMITS,
  EVIDENCE_PROMPT_VERSION,
  EVIDENCE_SCHEMA_VERSION,
  EvidenceError,
  conditionCodeSchema,
  evidenceIdSchema,
  type ConfirmedCondition,
  type EvidenceSettings,
  type EvidenceProvenanceManifest,
} from '@/lib/evidence/contracts';
import {
  evidenceDigest,
  provenanceFingerprint,
  validatePreparedSource,
} from '@/lib/evidence/context';

const sourceSchema = z.strictObject({
  stageId: evidenceIdSchema,
  sceneId: evidenceIdSchema,
  attemptId: evidenceIdSchema,
  versionId: evidenceIdSchema,
  submissionId: evidenceIdSchema,
  sourceFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  conditions: z.array(conditionCodeSchema).min(1).max(3),
});
const manifestSchema = z
  .strictObject({ version: z.literal(1), sources: z.array(sourceSchema).min(1).max(1000) })
  .superRefine((value, ctx) => {
    const identities = value.sources.map(
      (source) =>
        `${source.stageId}/${source.sceneId}/${source.attemptId}/${source.versionId}/${source.submissionId}`,
    );
    if (
      new Set(identities).size !== identities.length ||
      value.sources.some(
        (source) =>
          new Set(source.conditions).size !== source.conditions.length ||
          !source.conditions.includes('controlled-proxy') ||
          !source.conditions.includes('not-personal-learner-evidence'),
      )
    )
      ctx.addIssue({ code: 'custom', message: 'Duplicate or unbounded provenance source' });
  });
export function parseEvidenceProvenance(value: unknown): EvidenceProvenanceManifest {
  const parsed = manifestSchema.safeParse(value);
  if (!parsed.success) throw new EvidenceError('EVIDENCE_PROVENANCE_INVALID', 503);
  return parsed.data;
}
export async function loadEvidenceSettings(
  env: Record<string, string | undefined> = process.env,
): Promise<EvidenceSettings> {
  if (env.OPENMAIC_EVIDENCE_ENABLED !== 'true') throw new EvidenceError('EVIDENCE_DISABLED', 404);
  const file = env.OPENMAIC_EVIDENCE_PROVENANCE_FILE;
  if (!file) throw new EvidenceError('EVIDENCE_PROVENANCE_UNAVAILABLE', 503);
  let provenance: EvidenceProvenanceManifest;
  try {
    const raw = await readFile(file, 'utf8');
    if (Buffer.byteLength(raw, 'utf8') > 1024 * 1024)
      throw new EvidenceError('EVIDENCE_PROVENANCE_INVALID', 503);
    provenance = parseEvidenceProvenance(JSON.parse(raw));
  } catch (error) {
    if (error instanceof EvidenceError) throw error;
    throw new EvidenceError('EVIDENCE_PROVENANCE_UNAVAILABLE', 503);
  }
  return {
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
}
export function matchEvidenceProvenance(
  quiz: PreparedQuiz,
  settings: EvidenceSettings | EvidenceProvenanceManifest,
): ConfirmedCondition[] {
  validatePreparedSource(quiz);
  const manifest = 'provenance' in settings ? settings.provenance : settings;
  const source = manifest.sources.find(
    (source) =>
      source.stageId === quiz.stageId &&
      source.sceneId === quiz.sceneId &&
      source.attemptId === quiz.attemptId &&
      source.versionId === quiz.version.id &&
      source.submissionId === quiz.submission!.id,
  );
  if (!source) throw new EvidenceError('SOURCE_NOT_ENABLED', 409);
  const fingerprint = provenanceFingerprint(quiz);
  if (source.sourceFingerprint !== fingerprint) throw new EvidenceError('PROVENANCE_MISMATCH', 409);
  return source.conditions.map((code) => ({
    code,
    submissionId: quiz.submission!.id,
    sourceFingerprint: fingerprint,
    origin: 'f63-review',
  }));
}
