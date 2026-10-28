import type { WithTransaction } from '@openmaic/storage/document/pg';
import type { SimulatedLearningLoopConfig } from './config';
import { enqueueReviewedQuiz } from './enqueue-reviewed';

/** Start only from explicit activation; never scan older saved reviews. */
export async function activateLearningLoop(
  withTransaction: WithTransaction,
  config: SimulatedLearningLoopConfig,
): Promise<void> {
  await withTransaction(async (tx) => {
    const created = await tx.query(
      'INSERT INTO quiz_learning_loop_activation(singleton,config) VALUES(true,$1::jsonb) ON CONFLICT(singleton) DO NOTHING RETURNING singleton',
      [JSON.stringify(config)],
    );
    if (created.rows.length) {
      await tx.query(
        'INSERT INTO quiz_learning_loop_preexisting_reviews(review_id) SELECT id FROM quiz_trace_reviews WHERE result IS NOT NULL ON CONFLICT DO NOTHING',
      );
    }
    const result = await tx.query<{ same: boolean } & Record<string, unknown>>(
      'SELECT config=$1::jsonb AS same FROM quiz_learning_loop_activation WHERE singleton=true',
      [JSON.stringify(config)],
    );
    if (!result.rows[0]?.same) throw new Error('LEARNING_LOOP_CONFIGURATION_CHANGED');
  });
}

/** Read persisted reviews after activation; job uniqueness makes rescans idempotent. */
export async function discoverReviewedQuizzes(
  withTransaction: WithTransaction,
  config: SimulatedLearningLoopConfig,
): Promise<number> {
  const entries = await withTransaction(async (tx) => {
    const result = await tx.query<{ owner_id: string; id: string } & Record<string, unknown>>(
      `SELECT a.owner_id,a.id FROM quiz_trace_attempts a
       JOIN quiz_trace_reviews r ON r.id=a.current_review_id AND r.result IS NOT NULL
         AND r.submission_id=a.submission->>'id'
       JOIN stage_meta m ON m.stage_id=a.stage_id AND m.owner_id=a.owner_id AND m.deleted_at IS NULL
       JOIN quiz_learning_loop_activation c ON c.singleton=true AND c.config=$1::jsonb
       WHERE NOT EXISTS (SELECT 1 FROM quiz_learning_loop_preexisting_reviews p WHERE p.review_id=r.id)
         AND NOT EXISTS (SELECT 1 FROM quiz_learning_loop_jobs j WHERE j.owner_id=a.owner_id AND j.submission_id=a.submission->>'id')
         AND 1=(SELECT count(*) FROM generation_runs g WHERE g.owner_id=a.owner_id AND g.stage_id=a.stage_id
           AND g.input->>'simulatedLearner' IN ('A','B','C')
           AND (EXISTS (SELECT 1 FROM generation_run_steps s WHERE s.run_id=g.id
             AND s.step_id LIKE 'scene:%:narration' AND s.output->'scene'->>'id'=a.scene_id)
             OR EXISTS (SELECT 1 FROM quiz_learning_scene_bindings b WHERE b.run_id=g.id
               AND b.owner_id=a.owner_id AND b.stage_id=a.stage_id AND b.scene_id=a.scene_id
               AND b.student=g.input->>'simulatedLearner')))
       ORDER BY r.result->>'savedAt', a.id LIMIT 50`,
      [JSON.stringify(config)],
    );
    return result.rows;
  });
  for (const entry of entries)
    await enqueueReviewedQuiz(withTransaction, entry.owner_id, entry.id, config);
  return entries.length;
}
