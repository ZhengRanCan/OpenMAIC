export const FORMAL_TEACHING_CONTEXT_VERSION = 'f23-v1' as const;

export interface FrozenTeachingContext {
  schemaVersion: typeof FORMAL_TEACHING_CONTEXT_VERSION;
  lessonRequirement: string;
  lessonKnowledgePointIds: string[];
  mappingId: string;
  mappingRevision: string;
  guidance: string[];
  checkpoint: {
    checkpointId: string;
    sceneId: string;
    remediationSceneId: string;
    remediationStrategy: string;
  };
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
    !safeText(value.checkpoint.sceneId, 120) ||
    !safeText(value.checkpoint.remediationSceneId, 120) ||
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
      sceneId: safeText(value.checkpoint.sceneId, 120),
      remediationSceneId: safeText(value.checkpoint.remediationSceneId, 120),
      remediationStrategy: safeText(value.checkpoint.remediationStrategy, 120),
    },
  };
}
