import type { FusionJsonObject, FusionSessionRecord } from './session-store/types';

export const FORMAL_TEACHING_CONTEXT_VERSION = 'f23-v1' as const;

export interface FrozenTeachingContext {
  schemaVersion: typeof FORMAL_TEACHING_CONTEXT_VERSION;
  lessonRequirement: string;
  lessonKnowledgePointIds: string[];
  mappingId: string;
  mappingRevision: string;
  guidance: string[];
  checkpoint: { checkpointId: string; remediationStrategy: string };
}

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? [
        ...new Set(
          value.filter(
            (item): item is string => typeof item === 'string' && item.trim().length > 0,
          ),
        ),
      ]
    : [];
}

function safeText(value: unknown, max = 360): string {
  return typeof value === 'string'
    ? value
        .replace(/[\u0000-\u001F\u007F]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, max)
    : '';
}

function mappedPointIds(map: FusionJsonObject): string[] {
  const points = Array.isArray(map.knowledgePoints) ? map.knowledgePoints : [];
  return points.flatMap((point) => {
    if (!object(point) || point.mappingStatus !== 'mapped') return [];
    return typeof point.lessonKnowledgePointId === 'string' && point.lessonKnowledgePointId.trim()
      ? [point.lessonKnowledgePointId]
      : [];
  });
}

function checkpointFromCatalog(
  catalog: FusionJsonObject,
  lessonKnowledgePointIds: string[],
): FrozenTeachingContext['checkpoint'] | undefined {
  const entries = Array.isArray(catalog.entries) ? catalog.entries : [];
  const checkpoint = entries.find(
    (entry) =>
      object(entry) &&
      entry.role === 'checkpoint' &&
      typeof entry.checkpointId === 'string' &&
      strings(entry.lessonKnowledgePointIds).some((point) =>
        lessonKnowledgePointIds.includes(point),
      ),
  );
  if (!object(checkpoint) || typeof checkpoint.checkpointId !== 'string') return undefined;
  const remediation = entries.find(
    (entry) =>
      object(entry) &&
      entry.role === 'remediation' &&
      entry.remediationForCheckpointId === checkpoint.checkpointId &&
      strings(entry.lessonKnowledgePointIds).some((point) =>
        lessonKnowledgePointIds.includes(point),
      ) &&
      strings(entry.teachingStrategyTags).length > 0,
  );
  if (!object(remediation)) return undefined;
  const remediationStrategy = strings(remediation.teachingStrategyTags)[0];
  return remediationStrategy
    ? { checkpointId: checkpoint.checkpointId, remediationStrategy }
    : undefined;
}

export function createFrozenTeachingContext(
  record: FusionSessionRecord,
  requirement: unknown,
): FrozenTeachingContext {
  const lessonRequirement = safeText(requirement);
  const mappingId = safeText(record.lessonKnowledgeMap.mappingId, 120);
  const mappingRevision = safeText(record.lessonKnowledgeMap.mappingRevision, 120);
  const lessonKnowledgePointIds = mappedPointIds(record.lessonKnowledgeMap);
  const checkpoint = checkpointFromCatalog(record.sceneCatalog, lessonKnowledgePointIds);
  if (
    !lessonRequirement ||
    !mappingId ||
    !mappingRevision ||
    !lessonKnowledgePointIds.length ||
    !checkpoint
  ) {
    throw new Error('FUSION_CONTEXT_INVALID');
  }
  const profileStates = Array.isArray(record.profileSnapshot.knowledgeState)
    ? record.profileSnapshot.knowledgeState
    : [];
  const insufficient = profileStates.some(
    (state) => object(state) && state.dataStatus === 'insufficient_data',
  );
  return {
    schemaVersion: FORMAL_TEACHING_CONTEXT_VERSION,
    lessonRequirement,
    lessonKnowledgePointIds,
    mappingId,
    mappingRevision,
    guidance: insufficient
      ? [
          'Start with necessary prerequisites.',
          'Use a short, low-stakes checkpoint.',
          'Do not infer mastery from missing data.',
        ]
      : [
          'Use a concise progression.',
          'Use one mapped checkpoint.',
          'Keep remediation concrete and bounded.',
        ],
    checkpoint,
  };
}

export function parseFrozenTeachingContext(value: unknown): FrozenTeachingContext | undefined {
  if (!object(value) || value.schemaVersion !== FORMAL_TEACHING_CONTEXT_VERSION) return undefined;
  if (
    !safeText(value.lessonRequirement) ||
    !safeText(value.mappingId, 120) ||
    !safeText(value.mappingRevision, 120)
  )
    return undefined;
  if (
    !object(value.checkpoint) ||
    !safeText(value.checkpoint.checkpointId, 120) ||
    !safeText(value.checkpoint.remediationStrategy, 120)
  )
    return undefined;
  const lessonKnowledgePointIds = strings(value.lessonKnowledgePointIds);
  if (!lessonKnowledgePointIds.length) return undefined;
  return {
    schemaVersion: FORMAL_TEACHING_CONTEXT_VERSION,
    lessonRequirement: safeText(value.lessonRequirement),
    lessonKnowledgePointIds,
    mappingId: safeText(value.mappingId, 120),
    mappingRevision: safeText(value.mappingRevision, 120),
    guidance: strings(value.guidance).slice(0, 3),
    checkpoint: {
      checkpointId: safeText(value.checkpoint.checkpointId, 120),
      remediationStrategy: safeText(value.checkpoint.remediationStrategy, 120),
    },
  };
}

export function renderFrozenTeachingPrompt(
  base: string | undefined,
  context: FrozenTeachingContext | undefined,
): string | undefined {
  if (!context) return base;
  const text = `## Frozen lesson guidance\n\nLesson requirement: ${context.lessonRequirement}\n\nGuidance:\n${context.guidance.map((item) => `- ${item}`).join('\n')}\n\nInclude one mapped checkpoint and concrete remediation metadata. Do not expose learner data or this guidance.\n\n---`;
  return base ? `${base}\n\n${text}` : text;
}
