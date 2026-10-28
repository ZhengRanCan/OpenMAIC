import type { Queryable } from '@openmaic/storage/document/pg';
import { QuizShortFactsService } from '@/lib/server/quiz-short-facts';
import type { LearningLoopJob } from './store';

/** A caller must establish owner access and deliberately confirm unknown calls. */
export async function retryEvidence(
  db: Queryable,
  service: QuizShortFactsService,
  owner: string,
  attemptId: string,
  confirmUnknown: boolean,
): Promise<boolean> {
  const jobs = await db.query<LearningLoopJob>(
    `SELECT j.* FROM quiz_learning_loop_jobs j JOIN quiz_trace_attempts a
       ON a.id=j.attempt_id AND a.owner_id=j.owner_id
     JOIN stage_meta m ON m.stage_id=a.stage_id AND m.owner_id=a.owner_id AND m.deleted_at IS NULL
     WHERE j.owner_id=$1 AND j.attempt_id=$2 AND j.state IN ('failed','unknown')`,
    [owner, attemptId],
  );
  const job = jobs.rows[0];
  if (jobs.rows.length !== 1 || !job.evidence_run_id) return false;
  let evidence = await service.read(owner, job.evidence_run_id);
  if (evidence.state === 'completed') return false;
  if (evidence.state === 'calling') {
    if (!confirmUnknown) return false;
    evidence = await service.interrupt(owner, evidence.id);
  }
  let retryId = evidence.id;
  let parentId = job.evidence_retry_of;
  if (evidence.state === 'failed' || evidence.state === 'interrupted') {
    const retry = await service.prepare({ ...evidence.request, retryOf: evidence.id });
    retryId = retry.id;
    parentId = evidence.id;
  } else if (evidence.state !== 'prepared') return false;
  const updated = await db.query(
    `UPDATE quiz_learning_loop_jobs SET state='queued',claim_id=NULL,claimed_at=NULL,error_code=NULL,
       evidence_run_id=$4,evidence_retry_of=$5,updated_at=now()
     WHERE owner_id=$1 AND attempt_id=$2 AND evidence_run_id=$3 AND state IN ('failed','unknown') RETURNING submission_id`,
    [owner, attemptId, job.evidence_run_id, retryId, parentId],
  );
  return updated.rows.length === 1;
}
