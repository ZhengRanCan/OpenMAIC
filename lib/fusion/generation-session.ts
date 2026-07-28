import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import type { SceneOutline } from '@/lib/types/generation';
import { ensureFusionServices, isProductionFusion } from './reliability/production-services';
import type { FusionJsonObject, FusionSessionRecord } from './session-store/types';
import {
  createFrozenTeachingContext,
  parseFrozenTeachingContext,
  renderFrozenTeachingPrompt,
  type FrozenTeachingContext,
} from './teaching-context';

const COOKIE = 'openmaic_fusion_session';
export type { FrozenTeachingContext } from './teaching-context';

export type FormalFusionResolution =
  | { kind: 'none' }
  | {
      kind: 'resolved';
      context: FrozenTeachingContext;
      record: FusionSessionRecord;
      outlines?: SceneOutline[];
    };

export class FormalFusionError extends Error {
  constructor(
    readonly code:
      | 'FUSION_SESSION_UNAVAILABLE'
      | 'FUSION_SESSION_MISMATCH'
      | 'FUSION_CONTEXT_INVALID'
      | 'FUSION_SESSION_ALREADY_GENERATED',
  ) {
    super('Restart the classroom from a new Launch Code.');
  }
}

export function formalFusionErrorResponse(error: FormalFusionError): NextResponse {
  const status = error.code === 'FUSION_SESSION_MISMATCH' ? 403 : 401;
  return NextResponse.json(
    {
      success: false,
      errorCode: error.code,
      error: 'Fusion session cannot generate this classroom. Restart from Launch.',
    },
    { status },
  );
}

function contextFrom(record: FusionSessionRecord): FrozenTeachingContext | undefined {
  return parseFrozenTeachingContext(record.generationContext);
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

function createContext(record: FusionSessionRecord, requirement: unknown): FrozenTeachingContext {
  try {
    return createFrozenTeachingContext(record, requirement);
  } catch {
    throw new FormalFusionError('FUSION_CONTEXT_INVALID');
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
  if (record.generationContext) throw new FormalFusionError('FUSION_SESSION_ALREADY_GENERATED');
  const context = createContext(record, requirement);
  const sessions = (await ensureFusionServices()).sessions;
  const updated = await sessions.compareAndSet(
    record.lessonSessionId,
    record.revision,
    (current) => ({
      ...current,
      generationContext: context as unknown as FusionJsonObject,
    }),
  );
  if (!updated) throw new FormalFusionError('FUSION_SESSION_ALREADY_GENERATED');
  return { kind: 'resolved', context, record: updated };
}

/** Adds the Catalog-owned checkpoint/remediation pair to the server-owned formal lesson. */
export function completeFormalLessonOutlines(
  context: FrozenTeachingContext,
  source: SceneOutline[],
): SceneOutline[] {
  const reserved = new Set([context.checkpoint.sceneId, context.checkpoint.remediationSceneId]);
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
    title: context.lessonRequirement,
    description: context.lessonRequirement,
  };
  const checkpoint: SceneOutline = {
    id: context.checkpoint.sceneId,
    type: 'quiz',
    title: localizedFallback.title,
    description: localizedFallback.description,
    keyPoints: [...context.lessonKnowledgePointIds],
    order: base.length + 1,
    quizConfig: { questionCount: 1, difficulty: 'easy', questionTypes: ['single'] },
    fusionCheckpoint: {
      checkpointId: context.checkpoint.checkpointId,
      mappingId: context.mappingId,
      mappingRevision: context.mappingRevision,
      lessonKnowledgePointIds: [...context.lessonKnowledgePointIds],
      remediationStrategy: context.checkpoint.remediationStrategy,
    },
  };
  const remediation: SceneOutline = {
    id: context.checkpoint.remediationSceneId,
    type: 'slide',
    title: localizedFallback.title,
    description: localizedFallback.description,
    keyPoints: [...context.lessonKnowledgePointIds],
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
          },
  );
  if (!updated || !outlinesFrom(updated)) throw new FormalFusionError('FUSION_CONTEXT_INVALID');
}

/** Deliberately renders only the frozen, minimal projection; no identity/raw snapshot enters prompts. */
export const appendFormalTeachingPrompt = renderFrozenTeachingPrompt;
