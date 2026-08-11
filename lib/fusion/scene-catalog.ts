import type { SceneOutline } from '@/lib/types/generation';
import type { FrozenLessonGenerationContext } from './preclass-contracts';

export interface SceneCatalogEntry {
  sceneId: string;
  order: number;
  role: 'teach' | 'checkpoint' | 'remediation';
  checkpointId?: string;
  lessonKnowledgePointIds: string[];
  remediationForCheckpointId?: string;
  teachingStrategyTags: string[];
}

export interface SceneCatalog {
  catalogId: string;
  /** Formal catalogs are bound to the frozen semantic request. */
  catalogRevision?: string;
  semanticRequestDigest?: string;
  contextId?: string;
  entries: SceneCatalogEntry[];
}

/** Derives the only formal catalog accepted by the classroom event path. */
export function buildFormalSceneCatalog(
  context: FrozenLessonGenerationContext,
  outlines: SceneOutline[],
): SceneCatalog {
  const checkpoint = outlines.find((outline) => outline.fusionCheckpoint);
  if (!checkpoint?.fusionCheckpoint) throw new Error('formal_checkpoint_missing');
  const checkpointMetadata = checkpoint.fusionCheckpoint;
  const remediation = outlines.find(
    (outline) => outline.id === `fusion-remediation-scene-${context.contextId}`,
  );
  if (!remediation) throw new Error('formal_remediation_missing');
  const entries: SceneCatalogEntry[] = outlines.map((outline, index) => {
    if (outline.id === checkpoint.id) {
      return {
        sceneId: outline.id,
        order: index + 1,
        role: 'checkpoint',
        checkpointId: checkpointMetadata.checkpointId,
        lessonKnowledgePointIds: [...checkpointMetadata.lessonKnowledgePointIds],
        teachingStrategyTags: [],
      };
    }
    if (outline.id === remediation.id) {
      return {
        sceneId: outline.id,
        order: index + 1,
        role: 'remediation',
        remediationForCheckpointId: checkpointMetadata.checkpointId,
        lessonKnowledgePointIds: [...checkpointMetadata.lessonKnowledgePointIds],
        teachingStrategyTags: [checkpointMetadata.remediationStrategy],
      };
    }
    return {
      sceneId: outline.id,
      order: index + 1,
      role: 'teach',
      lessonKnowledgePointIds: [...outline.keyPoints],
      teachingStrategyTags: [],
    };
  });
  return {
    catalogId: `fusion-scene-catalog-${context.contextId}`,
    catalogRevision: context.proposal.teachingGuidance.guidanceRevision,
    semanticRequestDigest: context.semanticRequest.semanticRequestDigest,
    contextId: context.contextId,
    entries,
  };
}

export function isFormalSceneCatalog(value: unknown): value is SceneCatalog {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const catalog = value as Partial<SceneCatalog>;
  return (
    typeof catalog.catalogId === 'string' &&
    !!catalog.catalogId &&
    typeof catalog.catalogRevision === 'string' &&
    !!catalog.catalogRevision &&
    typeof catalog.semanticRequestDigest === 'string' &&
    /^sha256:[a-f0-9]{64}$/.test(catalog.semanticRequestDigest) &&
    typeof catalog.contextId === 'string' &&
    !!catalog.contextId &&
    Array.isArray(catalog.entries) &&
    catalog.entries.length > 0
  );
}

/** Fixed, reviewable Development Only catalog; no generated scene is created at runtime. */
export const DEVELOPMENT_SCENE_CATALOG: SceneCatalog = {
  catalogId: 'development-linear-function-v1',
  entries: [
    {
      sceneId: 'teach-slope',
      order: 1,
      role: 'teach',
      lessonKnowledgePointIds: ['lesson-linear-function-slope'],
      teachingStrategyTags: [],
    },
    {
      sceneId: 'checkpoint-slope',
      order: 2,
      role: 'checkpoint',
      checkpointId: 'development-checkpoint',
      lessonKnowledgePointIds: ['lesson-linear-function-slope'],
      teachingStrategyTags: [],
    },
    {
      sceneId: 'remediate-slope-concrete',
      order: 3,
      role: 'remediation',
      remediationForCheckpointId: 'development-checkpoint',
      lessonKnowledgePointIds: ['lesson-linear-function-slope'],
      teachingStrategyTags: ['development_mock_concrete_example'],
    },
  ],
};
