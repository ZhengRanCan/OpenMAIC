export interface LessonRuntimeState {
  currentSceneId: string;
  checkpointRetryCounts: Record<string, number>;
  usedRemediationSceneIds: string[];
  executedDirectiveIds: string[];
  executedSourceEventIds: string[];
  revision: number;
}

export const createLessonRuntimeState = (currentSceneId = 'checkpoint-slope'): LessonRuntimeState => ({ currentSceneId, checkpointRetryCounts: {}, usedRemediationSceneIds: [], executedDirectiveIds: [], executedSourceEventIds: [], revision: 0 });
