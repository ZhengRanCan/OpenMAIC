import type { SceneDirective, TeachingIntent } from './contracts';
import type { SceneCatalog } from './scene-catalog';
import type { LessonRuntimeState } from './lesson-runtime-state';

export interface PlanResult { directive: SceneDirective; nextState: LessonRuntimeState; }
const id = (eventId: string, revision: number) => `directive_${eventId}_${revision}`;

export function planSceneDirective(intent: TeachingIntent | { kind: string }, sourceEventId: string, catalog: SceneCatalog, state: LessonRuntimeState, expectedRuntimeRevision = state.revision): PlanResult {
  const base = (kind: SceneDirective['kind'], reasonCode?: string, targetSceneId?: string): PlanResult => ({ directive: { schemaVersion: 'v1', directiveId: id(sourceEventId, state.revision), sourceEventId, kind, ...(targetSceneId ? { targetSceneId } : {}), ...(reasonCode ? { reasonCode } : {}), expectedRuntimeRevision: state.revision }, nextState: state });
  if (state.executedSourceEventIds.includes(sourceEventId)) return base('continue', 'duplicate_event');
  if (expectedRuntimeRevision !== state.revision) return base('continue', 'runtime_revision_conflict');
  if (!['continue', 'insert_remediation', 'retry_checkpoint'].includes(intent.kind)) return base('continue', 'unknown_intent');
  if (intent.kind === 'continue') return base('continue');
  const checkpoint = catalog.entries.find((entry) => entry.sceneId === state.currentSceneId && entry.role === 'checkpoint');
  if (!checkpoint?.checkpointId) return base('continue', 'checkpoint_unavailable');
  if (intent.kind === 'retry_checkpoint') {
    if ((state.checkpointRetryCounts[checkpoint.checkpointId] ?? 0) >= 1) return base('continue', 'retry_limit_reached');
    return base('retry_checkpoint', undefined, checkpoint.sceneId);
  }
  const typed = intent as TeachingIntent;
  const candidate = catalog.entries.find((entry) => entry.role === 'remediation' && entry.remediationForCheckpointId === checkpoint.checkpointId && !state.usedRemediationSceneIds.includes(entry.sceneId) && entry.lessonKnowledgePointIds.some((point) => typed.targetLessonKnowledgePointIds.includes(point)) && entry.teachingStrategyTags.includes(typed.recommendedStrategy));
  return candidate ? base('insert_remediation', undefined, candidate.sceneId) : base('continue', 'no_matching_remediation');
}
