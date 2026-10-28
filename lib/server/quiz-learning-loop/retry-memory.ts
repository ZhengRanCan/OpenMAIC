import { randomUUID } from 'node:crypto';
import type { Queryable } from '@openmaic/storage/document/pg';
import type { PreparedMemoryRun } from '@/lib/learner-memory/contracts';
import { simulatedScope } from '@/lib/learner-memory/simulated-seeds';
import type { SimulatedMemoryEnvironment } from '@/lib/learner-memory/simulated-environment';
import { QuizShortFactsService } from '@/lib/server/quiz-short-facts';
import type { LearningLoopJob } from './store';

/** Preserve the completed Evidence and recover only the Memory stage. */
export async function retryMemory(
  db: Queryable,
  service: QuizShortFactsService,
  memory: SimulatedMemoryEnvironment,
  owner: string,
  attemptId: string,
  confirmUnknown: boolean,
): Promise<'queued' | 'completed' | null> {
  const jobs = await db.query<LearningLoopJob>(
    `SELECT j.* FROM quiz_learning_loop_jobs j JOIN quiz_trace_attempts a
       ON a.id=j.attempt_id AND a.owner_id=j.owner_id
     JOIN stage_meta m ON m.stage_id=a.stage_id AND m.owner_id=a.owner_id AND m.deleted_at IS NULL
     WHERE j.owner_id=$1 AND j.attempt_id=$2 AND j.state IN ('failed','unknown')`,
    [owner, attemptId],
  );
  const job = jobs.rows[0];
  if (jobs.rows.length !== 1 || !job.evidence_run_id || !job.attribution) return null;
  const evidence = await service.read(owner, job.evidence_run_id);
  if (evidence.state !== 'completed') return null;
  const scope = simulatedScope(job.attribution.student);
  const operationId = `f68:${evidence.id}${job.memory_recovery_id ? `:${job.memory_recovery_id}` : ''}`;
  const run = await memory.provider.withTransaction(async (tx) => {
    const environment = await tx.query<{ id: string } & Record<string, unknown>>(
      'SELECT id FROM f68_memory_environment WHERE singleton=true',
    );
    if (
      environment.rows.length !== 1 ||
      environment.rows[0].id !== job.attribution!.memoryEnvironmentId
    )
      throw new Error('MEMORY_ENVIRONMENT_MISMATCH');
    const result = await tx.query<{ data: PreparedMemoryRun } & Record<string, unknown>>(
      'SELECT data FROM learner_memory_runs WHERE namespace=$1 AND learner_key=$2 AND id=$3',
      [scope.namespace, scope.learnerKey, operationId],
    );
    return result.rows[0]?.data ?? null;
  });
  if (!run && job.memory_recovery_id) return null;
  let state: 'queued' | 'completed' = 'queued';
  let recoveryId = job.memory_recovery_id;
  if (run?.state === 'calling') {
    if (!confirmUnknown) return null;
    await service.interruptMemory(owner, evidence.id, memory, recoveryId ?? undefined);
    recoveryId = randomUUID().replaceAll('-', '');
  } else if (run && ['failed', 'conflict'].includes(run.state)) {
    recoveryId = randomUUID().replaceAll('-', '');
  } else if (run?.state === 'completed') {
    if (run.decisions?.some((decision) => decision.action === 'defer'))
      recoveryId = randomUUID().replaceAll('-', '');
    else state = 'completed';
  } else if (run?.state === 'noop') state = 'completed';
  else if (run && !['prepared', 'captured'].includes(run.state)) return null;
  const updated = await db.query(
    `UPDATE quiz_learning_loop_jobs SET state=$4,claim_id=NULL,claimed_at=NULL,error_code=NULL,
       memory_recovery_id=$5,updated_at=now()
     WHERE owner_id=$1 AND attempt_id=$2 AND evidence_run_id=$3 AND state IN ('failed','unknown') RETURNING submission_id`,
    [owner, attemptId, evidence.id, state, recoveryId],
  );
  return updated.rows.length === 1 ? state : null;
}
