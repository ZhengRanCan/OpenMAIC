import type { Queryable } from '@openmaic/storage/document/pg';
import { checkpointLearningLoopEvidence, finishLearningLoop, type LearningLoopJob } from './store';

/** An adapter must validate source attribution before preparing a run. */
export interface LearningLoopProcessor {
  prepare(job: LearningLoopJob): Promise<{ id: string; state: string }>;
  extract(job: LearningLoopJob, id: string): Promise<{ id: string; state: string }>;
  handoff(
    job: LearningLoopJob,
    id: string,
  ): Promise<{
    state: string;
    decisions?: ReadonlyArray<{ action: string }>;
  }>;
}

/** Execute a claimed job without holding a database transaction across a model call. */
export async function processLearningLoop(
  db: Queryable,
  job: LearningLoopJob,
  processor: LearningLoopProcessor,
): Promise<void> {
  if (job.state !== 'running' || !job.claim_id) throw new Error('INVALID_LEARNING_LOOP_CLAIM');
  const claim = job.claim_id;
  let evidenceId = job.evidence_run_id;
  const finish = (state: 'unknown' | 'failed' | 'completed', code: string | null) =>
    finishLearningLoop(db, job, claim, state, evidenceId, code);
  try {
    const prepared = await processor.prepare(job);
    if (evidenceId && evidenceId !== prepared.id) {
      await finish('failed', 'EVIDENCE_BINDING_CONFLICT');
      return;
    }
    evidenceId = prepared.id;
    if (!(await checkpointLearningLoopEvidence(db, job, claim, evidenceId))) return;
    let evidence = prepared;
    if (evidence.state === 'prepared') evidence = await processor.extract(job, evidenceId);
    if (evidence.id !== evidenceId) {
      await finish('failed', 'EVIDENCE_BINDING_CONFLICT');
      return;
    }
    if (evidence.state === 'calling') {
      await finish('unknown', 'EVIDENCE_CALL_UNKNOWN');
      return;
    }
    if (evidence.state !== 'completed') {
      await finish('failed', 'EVIDENCE_NOT_COMPLETED');
      return;
    }
    const memory = await processor.handoff(job, evidenceId);
    if (memory.state === 'calling') {
      await finish('unknown', 'MEMORY_CALL_UNKNOWN');
    } else if (!['completed', 'noop', 'empty'].includes(memory.state)) {
      await finish('failed', 'MEMORY_NOT_COMPLETED');
    } else if (memory.decisions?.some((decision) => decision.action === 'defer')) {
      await finish('failed', 'MEMORY_DEFERRED');
    } else {
      await finish('completed', null);
    }
  } catch {
    // The underlying call may have completed even when the response was lost.
    // Do not expose exception text (which may contain student data), or retry.
    await finish('unknown', 'PROCESS_RESULT_UNKNOWN');
  }
}
