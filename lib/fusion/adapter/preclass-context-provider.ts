import { randomUUID } from 'node:crypto';
import {
  computeSemanticRequestDigest,
  parseFrozenLessonGenerationContext,
  parseLessonSemanticRequest,
  parsePreClassTeachingContextProposal,
  parseSemanticResolution,
  parseStrictJson,
  PRECLASS_CONTRACT_VERSION,
  PreClassContractError,
  type FrozenLessonGenerationContext,
  type LessonSemanticRequest,
  type PreClassTeachingContextProposal,
  type SemanticResolution,
} from '../preclass-contracts';
import { ensureFusionServices } from '../reliability/production-services';
import type { PreClassContextShadow, FusionSessionRecord } from '../session-store/types';
import {
  FORMAL_TEACHING_CONTEXT_VERSION,
  parseFrozenTeachingContext,
  type FrozenTeachingContext,
} from '../teaching-context';

const SHADOW_VERSION = 'preclass-context-shadow-v1' as const;
const SHADOW_SCOPE = 'preclass-context:read';

function normalizedRequirement(requirement: unknown): string {
  if (typeof requirement !== 'string') throw new PreClassContractError('invalid_requirement');
  const normalized = requirement
    .replace(/[\u0000-\u001F\u007F]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized || normalized.length > 512)
    throw new PreClassContractError('invalid_requirement');
  return normalized.normalize('NFC');
}

/**
 * The formal request deliberately starts with no locally inferred Profile or
 * Map.  Knowledge scope is resolved by DeepTutor under the scoped delegation;
 * the response must still return a complete, in-scope Map before it can freeze.
 */
export function buildFormalLessonSemanticRequest(
  record: FusionSessionRecord,
  requirement: unknown,
): LessonSemanticRequest {
  if (!record.courseScopeRef?.scopeId || !record.courseScopeRef.revision)
    throw new PreClassContractError('course_scope_unavailable');
  const draft: LessonSemanticRequest = {
    schemaVersion: PRECLASS_CONTRACT_VERSION,
    semanticRequestId: `preclass-${randomUUID()}`,
    semanticRequestRevision: '1',
    lessonSessionId: record.lessonSessionId,
    semanticRequestDigest:
      'sha256:0000000000000000000000000000000000000000000000000000000000000000',
    normalizedTopic: normalizedRequirement(requirement),
    normalizedLearningObjectives: [normalizedRequirement(requirement)],
    authorizedKnowledgeScope: {
      namespace: 'deeptutor',
      scopeId: record.courseScopeRef.scopeId,
      allowedKnowledgeRefs: [],
    },
    audienceSemantics: { audienceType: 'classroom', language: 'und' },
    teachingConstraints: { durationMinutes: 15, maxSceneCount: 16 },
    requestedKnowledgeRefs: [],
    sourceMaterialRefs: [],
    warnings: [],
  };
  return parseLessonSemanticRequest({
    ...draft,
    semanticRequestDigest: computeSemanticRequestDigest(draft),
  });
}

export function isPreClassContextShadowEnabled(
  env: { FUSION_PRECLASS_CONTEXT_SHADOW_ENABLED?: string } = process.env as {
    FUSION_PRECLASS_CONTEXT_SHADOW_ENABLED?: string;
  },
): boolean {
  return env.FUSION_PRECLASS_CONTEXT_SHADOW_ENABLED === 'true';
}

/**
 * Builds a request solely from the server-owned, already-frozen legacy
 * context. Browser input, learner identity, tokens, and raw materials never
 * participate in this conversion. Content-addressed material refs will be
 * added only when OpenMAIC owns such refs server-side; until then the set is
 * intentionally empty rather than accepting browser blobs or URLs.
 */
export function buildShadowLessonSemanticRequest(
  record: FusionSessionRecord,
  legacy: FrozenTeachingContext,
): LessonSemanticRequest {
  const scopeId = `openmaic-shadow-${record.lessonSessionId}`;
  const allowedKnowledgeRefs = legacy.lessonKnowledgePointIds.map((id) => ({
    namespace: 'openmaic',
    scopeId,
    id,
  }));
  const draft: LessonSemanticRequest = {
    schemaVersion: PRECLASS_CONTRACT_VERSION,
    semanticRequestId: `preclass-shadow-${record.lessonSessionId}`,
    semanticRequestRevision: 'shadow-v1',
    lessonSessionId: record.lessonSessionId,
    semanticRequestDigest:
      'sha256:0000000000000000000000000000000000000000000000000000000000000000',
    normalizedTopic: legacy.lessonRequirement,
    normalizedLearningObjectives: [legacy.lessonRequirement],
    authorizedKnowledgeScope: {
      namespace: 'openmaic',
      scopeId,
      allowedKnowledgeRefs,
    },
    audienceSemantics: { audienceType: 'classroom', language: 'und' },
    teachingConstraints: { durationMinutes: 15, maxSceneCount: 16 },
    requestedKnowledgeRefs: allowedKnowledgeRefs,
    sourceMaterialRefs: [],
    warnings: [],
  };
  return parseLessonSemanticRequest({
    ...draft,
    semanticRequestDigest: computeSemanticRequestDigest(draft),
  });
}

function captured(
  request: LessonSemanticRequest,
  proposal: PreClassTeachingContextProposal,
): PreClassContextShadow {
  const resolution: SemanticResolution = parseSemanticResolution(
    {
      schemaVersion: PRECLASS_CONTRACT_VERSION,
      semanticRequestId: request.semanticRequestId,
      semanticRequestRevision: request.semanticRequestRevision,
      semanticRequestDigest: request.semanticRequestDigest,
      status: proposal.resolutionStatus,
      clarificationIssues: proposal.clarificationIssues,
    },
    request,
  );
  const frozenContext: FrozenLessonGenerationContext = parseFrozenLessonGenerationContext({
    schemaVersion: PRECLASS_CONTRACT_VERSION,
    contextId: `shadow-context-${randomUUID()}`,
    semanticRequest: request,
    proposal,
    resolution,
    frozenAt: new Date().toISOString(),
  });
  const proposalRefKeys = new Set(
    proposal.lessonKnowledgeMap.knowledgeRefs.map((ref) =>
      [ref.namespace, ref.scopeId, ref.id].join('\u0000'),
    ),
  );
  const requestRefKeys = request.requestedKnowledgeRefs.map((ref) =>
    [ref.namespace, ref.scopeId, ref.id].join('\u0000'),
  );
  return {
    schemaVersion: SHADOW_VERSION,
    status: 'captured',
    observedAt: frozenContext.frozenAt,
    requestRef: {
      semanticRequestId: request.semanticRequestId,
      semanticRequestRevision: request.semanticRequestRevision,
      semanticRequestDigest: request.semanticRequestDigest,
    },
    comparison: {
      topic:
        proposal.interpretedLessonSemantics.normalizedTopic === request.normalizedTopic
          ? 'match'
          : 'mismatch',
      knowledgeScope:
        requestRefKeys.length === proposalRefKeys.size &&
        requestRefKeys.every((key) => proposalRefKeys.has(key))
          ? 'match'
          : 'mismatch',
      errorType: 'match',
    },
  };
}

function failed(error: unknown): PreClassContextShadow {
  const code = error instanceof PreClassContractError ? error.code : 'provider_unavailable';
  return {
    schemaVersion: SHADOW_VERSION,
    status: 'provider_failed',
    observedAt: new Date().toISOString(),
    comparison: {
      topic: 'unavailable',
      knowledgeScope: 'unavailable',
      errorType: 'mismatch',
    },
    errorCode: code,
  };
}

async function requestProposal(
  record: FusionSessionRecord,
  request: LessonSemanticRequest,
  fetchFn: typeof fetch,
): Promise<PreClassTeachingContextProposal> {
  const services = await ensureFusionServices();
  const credential = await services.credentials.get(record.credentialRef, record.lessonSessionId);
  if (!credential) throw new PreClassContractError('delegation_unavailable');
  if (!credential.scope.includes(SHADOW_SCOPE))
    throw new PreClassContractError('delegation_scope_invalid');
  const base = process.env.DEEPTUTOR_FUSION_BASE_URL;
  if (!base) throw new PreClassContractError('provider_disabled');
  return services.circuits.run('preclass-context-read', async () => {
    const response = await fetchFn(`${base.replace(/\/+$/, '')}/api/v1/fusion/pre-class/context`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${credential.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
      cache: 'no-store',
    });
    if (!response.ok) throw new PreClassContractError('provider_unavailable');
    return parsePreClassTeachingContextProposal(parseStrictJson(await response.text()), request);
  });
}

export interface FormalPreClassContextOutcome {
  request: LessonSemanticRequest;
  result: FrozenLessonGenerationContext | SemanticResolution;
}

/** F48: resolves an explicit, already-built request through the bounded provider. */
export async function resolveFormalPreClassContext(
  record: FusionSessionRecord,
  request: LessonSemanticRequest,
  fetchFn: typeof fetch = fetch,
): Promise<FrozenLessonGenerationContext | SemanticResolution> {
  const proposal = await requestProposal(record, request, fetchFn);
  const resolution = parseSemanticResolution(
    {
      schemaVersion: PRECLASS_CONTRACT_VERSION,
      semanticRequestId: request.semanticRequestId,
      semanticRequestRevision: request.semanticRequestRevision,
      semanticRequestDigest: request.semanticRequestDigest,
      status: proposal.resolutionStatus,
      clarificationIssues: proposal.clarificationIssues,
    },
    request,
  );
  if (resolution.status !== 'ready') return resolution;
  if (
    !proposal.lessonKnowledgeMap.knowledgeRefs.length ||
    proposal.lessonKnowledgeMap.knowledgeRefs.some(
      (ref) =>
        ref.namespace !== request.authorizedKnowledgeScope.namespace ||
        ref.scopeId !== request.authorizedKnowledgeScope.scopeId,
    )
  ) {
    throw new PreClassContractError('map_outside_authorized_scope');
  }
  return parseFrozenLessonGenerationContext({
    schemaVersion: PRECLASS_CONTRACT_VERSION,
    contextId: `frozen-${randomUUID()}`,
    semanticRequest: request,
    proposal,
    resolution,
    frozenAt: new Date().toISOString(),
  });
}

export async function requestFormalPreClassContext(
  record: FusionSessionRecord,
  requirement: unknown,
  fetchFn: typeof fetch = fetch,
): Promise<FormalPreClassContextOutcome> {
  const request = buildFormalLessonSemanticRequest(record, requirement);
  return { request, result: await resolveFormalPreClassContext(record, request, fetchFn) };
}

/**
 * F49: server-owned projection of the formal frozen context into the legacy
 * f23-v1 teaching-context shape consumed by the shadow provider. Built solely
 * from the already-frozen Formal context and revalidated by the legacy parser;
 * browser input, learner identity, tokens, and raw materials never participate.
 * Checkpoint ids follow the same derivation used when the formal lesson is
 * completed, so the shadow comparison stays stable. Returns undefined when the
 * projection is invalid, which only skips the optional diagnostic.
 */
export function buildShadowFrozenTeachingContext(
  context: FrozenLessonGenerationContext,
): FrozenTeachingContext | undefined {
  const lessonKnowledgePointIds = context.proposal.lessonKnowledgeMap.knowledgeRefs.map(
    (ref) => ref.id,
  );
  const contextId = context.contextId;
  const remediationStrategy = context.proposal.teachingGuidance.recommendedApproaches[0] ?? '';
  return parseFrozenTeachingContext({
    schemaVersion: FORMAL_TEACHING_CONTEXT_VERSION,
    lessonRequirement: context.semanticRequest.normalizedTopic,
    lessonKnowledgePointIds,
    mappingId: context.proposal.lessonKnowledgeMap.mappingId,
    mappingRevision: context.proposal.lessonKnowledgeMap.mappingRevision,
    guidance: context.proposal.teachingGuidance.recommendedApproaches,
    checkpoint: {
      checkpointId: `fusion-checkpoint-${contextId}`,
      sceneId: `fusion-checkpoint-scene-${contextId}`,
      remediationSceneId: `fusion-remediation-scene-${contextId}`,
      remediationStrategy,
    },
  });
}

/**
 * Executes the server-owned shadow read and persists a single immutable
 * result. Errors are represented as a stable classification so the legacy
 * classroom path can continue without any mock or hidden fallback.
 */
export async function recordPreClassContextShadow(
  record: FusionSessionRecord,
  legacy: FrozenTeachingContext,
  fetchFn: typeof fetch = fetch,
): Promise<FusionSessionRecord | undefined> {
  if (record.preClassContextShadow) return record;
  let shadow: PreClassContextShadow;
  try {
    const request = buildShadowLessonSemanticRequest(record, legacy);
    shadow = captured(request, await requestProposal(record, request, fetchFn));
  } catch (error) {
    shadow = failed(error);
  }
  const sessions = (await ensureFusionServices()).sessions;
  return sessions.compareAndSet(record.lessonSessionId, record.revision, (current) =>
    current.preClassContextShadow ? current : { ...current, preClassContextShadow: shadow },
  );
}
