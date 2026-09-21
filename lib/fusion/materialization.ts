import type { SceneOutline } from '@/lib/types/generation';
import type { Scene } from '@/lib/types/stage';

export type FormalMaterializationFailureCode =
  | 'PAIR_PLAN_MISSING'
  | 'PAIR_CONTENT_MATERIALIZATION_FAILED'
  | 'PAIR_ACTION_BUILD_FAILED'
  | 'PAIR_CLASSROOM_STORE_LOST'
  | 'PAIR_EXPORT_PROJECTION_FAILED';

export class FormalMaterializationError extends Error {
  constructor(
    readonly code: FormalMaterializationFailureCode,
    readonly details: Record<string, unknown> = {},
  ) {
    super(`${code}: formal Fusion checkpoint/remediation pair is incomplete`);
    this.name = 'FormalMaterializationError';
  }
}

export function isFormalFusionOutline(outline: SceneOutline): boolean {
  return outline.id.startsWith('fusion-checkpoint-scene-') || outline.id.startsWith('fusion-remediation-scene-');
}

export function assertFormalPairOutlines(outlines: readonly SceneOutline[]): void {
  const checkpoint = outlines.filter((outline) => outline.fusionRole === 'checkpoint' || outline.fusionCheckpoint);
  const remediation = outlines.filter(
    (outline) => outline.id.startsWith('fusion-remediation-scene-') && outline.fusionRole === 'remediation',
  );
  const checkpointMetadata = checkpoint[0]?.fusionCheckpoint;
  const remediationContext = remediation[0]?.id.startsWith('fusion-remediation-scene-')
    ? remediation[0].id.replace('fusion-remediation-scene-', '')
    : '';
  if (checkpoint.length !== 1 || remediation.length !== 1) {
    throw new FormalMaterializationError('PAIR_PLAN_MISSING', {
      checkpointCount: checkpoint.length,
      remediationCount: remediation.length,
    });
  }
  const [checkpointOutline] = checkpoint;
  const [remediationOutline] = remediation;
  if (
    checkpointOutline.type !== 'quiz' ||
    remediationOutline.type !== 'slide' ||
    !remediationContext ||
    !checkpointMetadata ||
    checkpointMetadata.checkpointId !== `fusion-checkpoint-${remediationContext}` ||
    !checkpointMetadata.mappingId ||
    !checkpointMetadata.mappingRevision ||
    checkpointMetadata.lessonKnowledgePointIds.length === 0 ||
    !checkpointMetadata.remediationStrategy
  ) {
    throw new FormalMaterializationError('PAIR_PLAN_MISSING', {
      checkpointSceneId: checkpointOutline.id,
      remediationSceneId: remediationOutline.id,
    });
  }
}

export function assertFormalPairScenes(
  outlines: readonly SceneOutline[],
  scenes: readonly Scene[],
): void {
  assertFormalPairOutlines(outlines);
  const checkpointOutline = outlines.find((outline) => outline.fusionRole === 'checkpoint' || outline.fusionCheckpoint)!;
  const remediationOutline = outlines.find(
    (outline) => outline.id.startsWith('fusion-remediation-scene-') && outline.fusionRole === 'remediation',
  )!;
  const checkpointScene = scenes.find(
    (scene) => scene.outlineId === checkpointOutline.id || scene.id === checkpointOutline.id,
  );
  const remediationScene = scenes.find(
    (scene) => scene.outlineId === remediationOutline.id || scene.id === remediationOutline.id,
  );
  if (!checkpointScene || !remediationScene) {
    throw new FormalMaterializationError('PAIR_CLASSROOM_STORE_LOST', {
      checkpointOutlineId: checkpointOutline.id,
      remediationOutlineId: remediationOutline.id,
    });
  }
  if (checkpointScene.type !== 'quiz' || remediationScene.type !== 'slide') {
    throw new FormalMaterializationError('PAIR_CLASSROOM_STORE_LOST', {
      checkpointSceneType: checkpointScene.type,
      remediationSceneType: remediationScene.type,
    });
  }
  if (!checkpointScene.fusionCheckpoint || checkpointScene.fusionRole !== 'checkpoint') {
    throw new FormalMaterializationError('PAIR_CLASSROOM_STORE_LOST', {
      checkpointSceneId: checkpointScene.id,
      reason: 'checkpoint binding or role missing',
    });
  }
  if (remediationScene.fusionRole !== 'remediation') {
    throw new FormalMaterializationError('PAIR_CLASSROOM_STORE_LOST', {
      remediationSceneId: remediationScene.id,
      reason: 'remediation role missing',
    });
  }
  const remediationContextId = remediationOutline.id.replace('fusion-remediation-scene-', '');
  if (checkpointScene.fusionCheckpoint.checkpointId !== `fusion-checkpoint-${remediationContextId}`) {
    throw new FormalMaterializationError('PAIR_CLASSROOM_STORE_LOST', {
      reason: 'checkpoint/remediation binding mismatch',
    });
  }
}
