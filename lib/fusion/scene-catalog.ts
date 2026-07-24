export interface SceneCatalogEntry {
  sceneId: string;
  order: number;
  role: 'teach' | 'checkpoint' | 'remediation';
  checkpointId?: string;
  lessonKnowledgePointIds: string[];
  remediationForCheckpointId?: string;
  teachingStrategyTags: string[];
}

export interface SceneCatalog { catalogId: string; entries: SceneCatalogEntry[]; }

/** Fixed, reviewable Development Only catalog; no generated scene is created at runtime. */
export const DEVELOPMENT_SCENE_CATALOG: SceneCatalog = {
  catalogId: 'development-linear-function-v1',
  entries: [
    { sceneId: 'teach-slope', order: 1, role: 'teach', lessonKnowledgePointIds: ['lesson-linear-function-slope'], teachingStrategyTags: [] },
    { sceneId: 'checkpoint-slope', order: 2, role: 'checkpoint', checkpointId: 'development-checkpoint', lessonKnowledgePointIds: ['lesson-linear-function-slope'], teachingStrategyTags: [] },
    { sceneId: 'remediate-slope-concrete', order: 3, role: 'remediation', remediationForCheckpointId: 'development-checkpoint', lessonKnowledgePointIds: ['lesson-linear-function-slope'], teachingStrategyTags: ['development_mock_concrete_example'] },
  ],
};
