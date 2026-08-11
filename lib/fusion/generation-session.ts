import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import type { SceneOutline } from '@/lib/types/generation';
import { ensureFusionServices, isProductionFusion } from './reliability/production-services';
import type { FusionJsonObject, FusionSessionRecord } from './session-store/types';
import {
  parseFrozenLessonGenerationContext,
  parseSemanticResolution,
  PreClassContractError,
  type FrozenLessonGenerationContext,
} from './preclass-contracts';
import { requestFormalPreClassContext } from './adapter/preclass-context-provider';
import { buildFormalSceneCatalog, isFormalSceneCatalog } from './scene-catalog';

const COOKIE = 'openmaic_fusion_session';
export type FormalFusionResolution =
  | { kind: 'none' }
  | {
      kind: 'resolved';
      context: FrozenLessonGenerationContext;
      record: FusionSessionRecord;
      outlines?: SceneOutline[];
    };

export class FormalFusionError extends Error {
  constructor(
    readonly code:
      | 'FUSION_SESSION_UNAVAILABLE'
      | 'FUSION_SESSION_MISMATCH'
      | 'FUSION_CONTEXT_INVALID'
      | 'FUSION_CONTEXT_NEEDS_CLARIFICATION'
      | 'FUSION_CONTEXT_PARTIAL'
      | 'FUSION_CONTEXT_UNRESOLVED'
      | 'FUSION_CONTEXT_REJECTED'
      | 'FUSION_CONTEXT_PROVIDER_UNAVAILABLE'
      | 'FUSION_SESSION_ALREADY_GENERATED'
      | 'FUSION_SOURCE_MATERIAL_UNAUTHORIZED',
  ) {
    super('Restart the classroom from a new Launch Code.');
  }
}

/** Formal generation accepts only server-owned material references. Raw browser
 * source bodies are never authoritative and are rejected when non-empty. */
export function assertFormalSourceMaterialBoundary(
  formal: FormalFusionResolution,
  input: {
    pdfText?: unknown;
    pdfImages?: unknown;
    researchContext?: unknown;
    imageMapping?: unknown;
  },
): void {
  if (formal.kind !== 'resolved') return;
  const hasText = typeof input.pdfText === 'string' && input.pdfText.trim().length > 0;
  const hasResearch =
    typeof input.researchContext === 'string' && input.researchContext.trim().length > 0;
  const hasImages = Array.isArray(input.pdfImages) && input.pdfImages.length > 0;
  const hasMapping =
    input.imageMapping && typeof input.imageMapping === 'object'
      ? Object.keys(input.imageMapping as Record<string, unknown>).length > 0
      : false;
  if (hasText || hasResearch || hasImages || hasMapping) {
    throw new FormalFusionError('FUSION_SOURCE_MATERIAL_UNAUTHORIZED');
  }
}

export function formalFusionErrorResponse(error: FormalFusionError): NextResponse {
  const status = error.code === 'FUSION_SESSION_MISMATCH' ? 403 : 409;
  return NextResponse.json(
    {
      success: false,
      errorCode: error.code,
      error: 'Fusion context cannot generate this classroom.',
      recovery: {
        kind: 'non_fusion',
        requiresNewSession: true,
        message: 'Start a new ordinary classroom. It will not reuse this Fusion context.',
      },
    },
    { status },
  );
}

function contextFrom(record: FusionSessionRecord): FrozenLessonGenerationContext | undefined {
  try {
    return record.frozenLessonGenerationContext
      ? parseFrozenLessonGenerationContext(record.frozenLessonGenerationContext)
      : undefined;
  } catch {
    return undefined;
  }
}

function storedOutline(value: unknown): SceneOutline | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const entry = value as Record<string, unknown>;
  const type = entry.type;
  const id = typeof entry.id === 'string' ? entry.id.trim() : '';
  const title = typeof entry.title === 'string' ? entry.title.trim() : '';
  const description = typeof entry.description === 'string' ? entry.description.trim() : '';
  const keyPoints = Array.isArray(entry.keyPoints)
    ? entry.keyPoints.filter(
        (point): point is string => typeof point === 'string' && !!point.trim(),
      )
    : [];
  if (
    !id ||
    !title ||
    !description ||
    !keyPoints.length ||
    !['slide', 'quiz', 'interactive', 'pbl'].includes(String(type))
  ) {
    return undefined;
  }
  const quizConfig =
    entry.quizConfig && typeof entry.quizConfig === 'object' && !Array.isArray(entry.quizConfig)
      ? (entry.quizConfig as {
          questionCount?: unknown;
          difficulty?: unknown;
          questionTypes?: unknown;
        })
      : undefined;
  return {
    id,
    type: type as SceneOutline['type'],
    title,
    description,
    keyPoints,
    order: typeof entry.order === 'number' && Number.isFinite(entry.order) ? entry.order : 0,
    ...(quizConfig &&
    typeof quizConfig.questionCount === 'number' &&
    ['easy', 'medium', 'hard'].includes(String(quizConfig.difficulty)) &&
    Array.isArray(quizConfig.questionTypes)
      ? {
          quizConfig: {
            questionCount: quizConfig.questionCount,
            difficulty: quizConfig.difficulty as 'easy' | 'medium' | 'hard',
            questionTypes: quizConfig.questionTypes.filter(
              (questionType): questionType is 'single' | 'multiple' | 'text' =>
                ['single', 'multiple', 'text'].includes(String(questionType)),
            ),
          },
        }
      : {}),
    ...(entry.fusionCheckpoint && typeof entry.fusionCheckpoint === 'object'
      ? { fusionCheckpoint: entry.fusionCheckpoint as SceneOutline['fusionCheckpoint'] }
      : {}),
  };
}

function outlinesFrom(record: FusionSessionRecord): SceneOutline[] | undefined {
  if (!record.generatedOutlines) return undefined;
  const outlines = record.generatedOutlines.map(storedOutline);
  return outlines.every((outline): outline is SceneOutline => !!outline) && outlines.length
    ? outlines
    : undefined;
}

function resolutionError(status: string): FormalFusionError {
  switch (status) {
    case 'needs_clarification':
      return new FormalFusionError('FUSION_CONTEXT_NEEDS_CLARIFICATION');
    case 'partial':
      return new FormalFusionError('FUSION_CONTEXT_PARTIAL');
    case 'unresolved':
      return new FormalFusionError('FUSION_CONTEXT_UNRESOLVED');
    case 'rejected':
      return new FormalFusionError('FUSION_CONTEXT_REJECTED');
    default:
      return new FormalFusionError('FUSION_CONTEXT_INVALID');
  }
}

function storedResolutionError(record: FusionSessionRecord): FormalFusionError | undefined {
  if (!record.preClassResolution) return undefined;
  try {
    return resolutionError(parseSemanticResolution(record.preClassResolution).status);
  } catch {
    return new FormalFusionError('FUSION_CONTEXT_INVALID');
  }
}

async function recoverFormalSession(
  request: NextRequest,
  lessonSessionId: unknown,
): Promise<FusionSessionRecord> {
  if (typeof lessonSessionId !== 'string' || !lessonSessionId)
    throw new FormalFusionError('FUSION_SESSION_UNAVAILABLE');
  if (!isProductionFusion()) throw new FormalFusionError('FUSION_SESSION_UNAVAILABLE');
  const record = await (
    await ensureFusionServices()
  ).sessions.recover(request.cookies.get(COOKIE)?.value ?? '');
  if (!record) throw new FormalFusionError('FUSION_SESSION_UNAVAILABLE');
  if (record.lessonSessionId !== lessonSessionId)
    throw new FormalFusionError('FUSION_SESSION_MISMATCH');
  return record;
}

/** Resolves the already frozen formal context for content/actions; no provider calls occur here. */
export async function resolveFormalFusion(
  request: NextRequest,
  lessonSessionId: unknown,
): Promise<FormalFusionResolution> {
  if (lessonSessionId === undefined || lessonSessionId === null || lessonSessionId === '')
    return { kind: 'none' };
  const record = await recoverFormalSession(request, lessonSessionId);
  const context = contextFrom(record);
  if (!context) throw new FormalFusionError('FUSION_CONTEXT_INVALID');
  if (record.generatedOutlines && !outlinesFrom(record)) {
    throw new FormalFusionError('FUSION_CONTEXT_INVALID');
  }
  if (record.generatedOutlines && !isFormalSceneCatalog(record.sceneCatalog)) {
    throw new FormalFusionError('FUSION_CONTEXT_INVALID');
  }
  if (
    record.sceneCatalog &&
    isFormalSceneCatalog(record.sceneCatalog) &&
    record.sceneCatalog.semanticRequestDigest !== context.semanticRequest.semanticRequestDigest
  ) {
    throw new FormalFusionError('FUSION_CONTEXT_INVALID');
  }
  return { kind: 'resolved', context, record, outlines: outlinesFrom(record) };
}

/** Atomically creates the sole formal context for this 15-minute lesson session. */
export async function freezeFormalFusionForOutline(
  request: NextRequest,
  lessonSessionId: unknown,
  requirement: unknown,
): Promise<FormalFusionResolution> {
  if (lessonSessionId === undefined || lessonSessionId === null || lessonSessionId === '')
    return { kind: 'none' };
  const record = await recoverFormalSession(request, lessonSessionId);
  if (record.generationContext || record.frozenLessonGenerationContext)
    throw new FormalFusionError('FUSION_SESSION_ALREADY_GENERATED');
  const priorResolution = storedResolutionError(record);
  if (priorResolution) throw priorResolution;
  let resolved: FrozenLessonGenerationContext;
  try {
    const result = await requestFormalPreClassContext(record, requirement);
    if ('status' in result) {
      const sessions = (await ensureFusionServices()).sessions;
      await sessions.compareAndSet(record.lessonSessionId, record.revision, (current) => ({
        ...current,
        preClassResolution: result as unknown as FusionJsonObject,
      }));
      throw resolutionError(result.status);
    }
    resolved = result;
  } catch (error) {
    if (error instanceof FormalFusionError) throw error;
    if (error instanceof PreClassContractError)
      throw new FormalFusionError('FUSION_CONTEXT_INVALID');
    throw new FormalFusionError('FUSION_CONTEXT_PROVIDER_UNAVAILABLE');
  }
  const knowledgeRefs = resolved.proposal.lessonKnowledgeMap.knowledgeRefs;
  const approaches = resolved.proposal.teachingGuidance.recommendedApproaches;
  if (!knowledgeRefs.length || !approaches.length)
    throw new FormalFusionError('FUSION_CONTEXT_INVALID');
  const sessions = (await ensureFusionServices()).sessions;
  const updated = await sessions.compareAndSet(
    record.lessonSessionId,
    record.revision,
    (current) => ({
      ...current,
      frozenLessonGenerationContext: resolved as unknown as FusionJsonObject,
    }),
  );
  if (!updated) throw new FormalFusionError('FUSION_SESSION_ALREADY_GENERATED');
  return { kind: 'resolved', context: resolved, record: updated };
}

/** Adds the Catalog-owned checkpoint/remediation pair to the server-owned formal lesson. */
export function completeFormalLessonOutlines(
  context: FrozenLessonGenerationContext,
  source: SceneOutline[],
): SceneOutline[] {
  const knowledgePointIds = context.proposal.lessonKnowledgeMap.knowledgeRefs.map((ref) => ref.id);
  const checkpointId = `fusion-checkpoint-${context.contextId}`;
  const checkpointSceneId = `fusion-checkpoint-scene-${context.contextId}`;
  const remediationSceneId = `fusion-remediation-scene-${context.contextId}`;
  const remediationStrategy = context.proposal.teachingGuidance.recommendedApproaches[0];
  const reserved = new Set([checkpointSceneId, remediationSceneId]);
  const base = source
    .filter((outline) => !reserved.has(outline.id))
    .map((outline, index) => ({
      id: outline.id,
      type: outline.type,
      title: outline.title,
      description: outline.description,
      keyPoints: [...outline.keyPoints],
      order: index + 1,
    }));
  const localizedFallback = base[0] ?? {
    title: context.semanticRequest.normalizedTopic,
    description: context.semanticRequest.normalizedTopic,
  };
  const checkpoint: SceneOutline = {
    id: checkpointSceneId,
    type: 'quiz',
    title: localizedFallback.title,
    description: localizedFallback.description,
    keyPoints: knowledgePointIds,
    order: base.length + 1,
    quizConfig: { questionCount: 1, difficulty: 'easy', questionTypes: ['single'] },
    fusionCheckpoint: {
      checkpointId,
      mappingId: context.proposal.lessonKnowledgeMap.mappingId,
      mappingRevision: context.proposal.lessonKnowledgeMap.mappingRevision,
      lessonKnowledgePointIds: knowledgePointIds,
      remediationStrategy,
    },
  };
  const remediation: SceneOutline = {
    id: remediationSceneId,
    type: 'slide',
    title: localizedFallback.title,
    description: localizedFallback.description,
    keyPoints: knowledgePointIds,
    order: base.length + 2,
  };
  return [...base, checkpoint, remediation];
}

/** Persists the one generated formal lesson so later stages never trust browser outlines. */
export async function persistFormalLessonOutlines(
  request: NextRequest,
  formal: FormalFusionResolution,
  outlines: SceneOutline[],
): Promise<void> {
  if (formal.kind !== 'resolved') return;
  const recovered = await recoverFormalSession(request, formal.record.lessonSessionId);
  const sessions = (await ensureFusionServices()).sessions;
  const updated = await sessions.compareAndSet(
    recovered.lessonSessionId,
    recovered.revision,
    (current) =>
      current.generatedOutlines
        ? current
        : {
            ...current,
            generatedOutlines: outlines as unknown as FusionJsonObject[],
            sceneCatalog: buildFormalSceneCatalog(
              formal.context,
              outlines,
            ) as unknown as FusionJsonObject,
            runtimeState: JSON.parse(
              JSON.stringify({
                ...(current.runtimeState as Record<string, unknown>),
                currentSceneId: outlines.find((outline) => outline.fusionCheckpoint)?.id,
              }),
            ),
          },
  );
  if (!updated || !outlinesFrom(updated)) throw new FormalFusionError('FUSION_CONTEXT_INVALID');
}

/** Deliberately renders only the frozen, minimal projection; no identity/raw snapshot enters prompts. */
/** Renders only the frozen semantic projection; learner signals never enter prompts. */
export function appendFormalTeachingPrompt(
  base: string | undefined,
  context: FrozenLessonGenerationContext | undefined,
): string | undefined {
  if (!context) return base;
  const approaches = context.proposal.teachingGuidance.recommendedApproaches
    .map((item) => `- ${item}`)
    .join('\n');
  const text = `## Frozen lesson guidance\n\nLesson requirement: ${context.semanticRequest.normalizedTopic}\n\nGuidance:\n${approaches}\n\nInclude one mapped checkpoint and concrete remediation metadata. Do not expose learner data or this guidance.\n\n---`;
  return base ? `${base}\n\n${text}` : text;
}
