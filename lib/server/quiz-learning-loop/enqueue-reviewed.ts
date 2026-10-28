import type { WithTransaction } from '@openmaic/storage/document/pg';
import type { SimulatedLearningLoopConfig } from './config';
import { enqueueLearningLoop } from './store';

/** Project a saved review into a job. The caller invokes this only after review commit. */
export async function enqueueReviewedQuiz(
  withTransaction: WithTransaction,
  owner: string,
  attemptId: string,
  config: SimulatedLearningLoopConfig,
): Promise<'queued' | 'ineligible'> {
  return withTransaction(async (tx) => {
    const result = await tx.query<
      {
        submission_id: string;
        run_id: string;
        student: 'A' | 'B' | 'C';
      } & Record<string, unknown>
    >(
      `SELECT a.submission->>'id' AS submission_id, g.id AS run_id,
              g.input->>'simulatedLearner' AS student
       FROM quiz_trace_attempts a
       JOIN stage_meta m ON m.stage_id=a.stage_id AND m.owner_id=a.owner_id AND m.deleted_at IS NULL
       JOIN quiz_trace_reviews r ON r.id=a.current_review_id AND r.attempt_id=a.id AND r.result IS NOT NULL
         AND r.submission_id=a.submission->>'id'
       JOIN generation_runs g ON g.owner_id=a.owner_id AND g.stage_id=a.stage_id
       WHERE a.owner_id=$1 AND a.id=$2 AND g.input->>'simulatedLearner' IN ('A','B','C')
         AND EXISTS (SELECT 1 FROM generation_run_steps s WHERE s.run_id=g.id
           AND s.step_id LIKE 'scene:%:narration' AND s.output->'scene'->>'id'=a.scene_id)`,
      [owner, attemptId],
    );
    if (result.rows.length === 0) return 'ineligible';
    if (result.rows.length !== 1) throw new Error('SIMULATED_IDENTITY_AMBIGUOUS');
    const row = result.rows[0];
    await enqueueLearningLoop(tx, {
      owner,
      attempt: attemptId,
      submission: row.submission_id,
      generationRun: row.run_id,
      attribution: { ...config, student: row.student },
    });
    return 'queued';
  });
}
