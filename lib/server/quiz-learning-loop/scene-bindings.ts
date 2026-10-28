import type { Queryable } from '@openmaic/storage/document/pg';

/** Minimal immutable proof retained before generation checkpoints are compacted. */
export async function ensureLearningSceneBindings(db: Queryable): Promise<void> {
  await db.query(`CREATE TABLE IF NOT EXISTS quiz_learning_scene_bindings (
    run_id TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    stage_id TEXT NOT NULL,
    scene_id TEXT NOT NULL,
    student TEXT NOT NULL CHECK (student IN ('A','B','C')),
    PRIMARY KEY (run_id,scene_id)
  )`);
}

/** The source is the generation checkpoint, never a user-supplied scene. */
export async function retainLearningSceneBindings(db: Queryable, runIds: string[]): Promise<void> {
  await db.query(
    `INSERT INTO quiz_learning_scene_bindings(run_id,owner_id,stage_id,scene_id,student)
     SELECT r.id,r.owner_id,r.stage_id,s.output->'scene'->>'id',r.input->>'simulatedLearner'
     FROM generation_runs r JOIN generation_run_steps s ON s.run_id=r.id
     WHERE r.id=ANY($1::text[]) AND r.input->>'simulatedLearner' IN ('A','B','C')
       AND s.step_id LIKE 'scene:%:narration' AND r.stage_id IS NOT NULL
       AND s.output->'scene'->>'stageId'=r.stage_id
       AND length(coalesce(s.output->'scene'->>'id',''))>0
     ON CONFLICT(run_id,scene_id) DO NOTHING`,
    [runIds],
  );
}
