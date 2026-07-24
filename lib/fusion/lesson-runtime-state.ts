export interface LessonRuntimeState {
  currentSceneId: string;
  checkpointRetryCounts: Record<string, number>;
  usedRemediationSceneIds: string[];
  executedDirectiveIds: string[];
  executedSourceEventIds: string[];
  revision: number;
}

export const createLessonRuntimeState = (currentSceneId = 'checkpoint-slope'): LessonRuntimeState => ({ currentSceneId, checkpointRetryCounts: {}, usedRemediationSceneIds: [], executedDirectiveIds: [], executedSourceEventIds: [], revision: 0 });

export function applyDirective(state: LessonRuntimeState, directive: { directiveId: string; sourceEventId: string; kind: 'continue' | 'insert_remediation' | 'retry_checkpoint'; targetSceneId?: string; expectedRuntimeRevision: number }): LessonRuntimeState | null {
  if (state.revision !== directive.expectedRuntimeRevision || state.executedDirectiveIds.includes(directive.directiveId) || state.executedSourceEventIds.includes(directive.sourceEventId)) return null;
  const next = { ...state, checkpointRetryCounts: { ...state.checkpointRetryCounts }, usedRemediationSceneIds: [...state.usedRemediationSceneIds], executedDirectiveIds: [...state.executedDirectiveIds, directive.directiveId], executedSourceEventIds: [...state.executedSourceEventIds, directive.sourceEventId], revision: state.revision + 1 };
  if (directive.kind === 'insert_remediation' && directive.targetSceneId) { next.currentSceneId = directive.targetSceneId; next.usedRemediationSceneIds.push(directive.targetSceneId); }
  if (directive.kind === 'retry_checkpoint' && directive.targetSceneId) { next.currentSceneId = directive.targetSceneId; next.checkpointRetryCounts['development-checkpoint'] = (next.checkpointRetryCounts['development-checkpoint'] ?? 0) + 1; }
  return next;
}
