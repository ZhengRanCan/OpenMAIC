import type { ServerPersistenceProvider } from './server-provider';
import { readPreparedIn, runtimeIn } from './quiz-trace';
import type { QuizHistoryRead } from '@/lib/quiz/trace-types';
import { QuizTraceError, requireId } from '@/lib/quiz/trace-validation';

export async function readQuizHistory(
  provider: ServerPersistenceProvider,
  owner: string,
  stageId: string,
): Promise<QuizHistoryRead> {
  requireId(stageId);
  // Single read snapshot. Never repairs/imports a legacy row.
  return provider.withTransaction(async (tx) => {
    await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
    const access = await tx.query(
      'SELECT stage_id FROM stage_meta WHERE stage_id=$1 AND owner_id=$2 AND deleted_at IS NULL',
      [stageId, owner],
    );
    if (!access.rows.length) throw new QuizTraceError('STAGE_NOT_FOUND', 404);
    const raw = await tx.query<{ id: string } & Record<string, unknown>>(
      "SELECT id FROM runtime_sessions WHERE learner_key=$1 AND stage_id=$2 AND kind='quizAttempt' ORDER BY created_at,id",
      [owner, stageId],
    );
    const bound = await tx.query<{ id: string } & Record<string, unknown>>(
      'SELECT id FROM quiz_trace_attempts WHERE owner_id=$1 AND stage_id=$2 ORDER BY created_at,id',
      [owner, stageId],
    );
    const result: QuizHistoryRead = {
      stageId,
      attempts: [],
      legacy: [],
      completeness: 'complete',
      checkedAttemptIds: [],
      failures: [],
    };
    for (const { id } of raw.rows) {
      result.checkedAttemptIds.push(id);
      try {
        if (bound.rows.some((b) => b.id === id))
          result.attempts.push(await readPreparedIn(tx, owner, id));
        else {
          const store = runtimeIn(tx);
          await store.getSession(id);
          result.legacy.push({
            attemptId: id,
            provenance: 'legacy-unverified',
            records: await store.listRecords(id),
            missing: ['historical-question-version'],
          });
        }
      } catch {
        result.failures.push({ attemptId: id, code: 'UNREADABLE_ATTEMPT' });
      }
    }
    result.attempts.sort(
      (a, b) =>
        bound.rows.findIndex((r) => r.id === a.attemptId) -
        bound.rows.findIndex((r) => r.id === b.attemptId),
    );
    if (result.failures.length) result.completeness = 'partial';
    return result;
  });
}
export async function readQuizAttempt(
  provider: ServerPersistenceProvider,
  owner: string,
  id: string,
) {
  requireId(id);
  return provider.withTransaction(async (tx) => {
    await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
    return readPreparedIn(tx, owner, id);
  });
}
export async function loadQuizForPlay(
  provider: ServerPersistenceProvider,
  owner: string,
  stageId: string,
  sceneId: string,
) {
  requireId(stageId);
  requireId(sceneId);
  const history = await readQuizHistory(provider, owner, stageId);
  if (history.failures.length) throw new QuizTraceError('HISTORY_INCOMPLETE', 503);
  return history.attempts.filter((a) => a.sceneId === sceneId).at(-1) ?? null;
}
