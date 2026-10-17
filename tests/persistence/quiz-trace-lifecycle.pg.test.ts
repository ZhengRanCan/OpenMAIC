import { describe, it, expect } from 'vitest';
import { traceFixture } from './quiz-trace-fixture';
import { deleteQuizTraceIn, rekeyQuizTraceIn } from '@/lib/persistence/quiz-trace-lifecycle';
import { readQuizAttempt } from '@/lib/persistence/quiz-trace-read';
describe.skipIf(!process.env.PG_CONTRACT_URL)('Quiz lifecycle (real PostgreSQL)', () => {
  it('claim preserves IDs and bindings, old owner cannot read, course delete cleans bound Runtime/versions', async () => {
    const f = await traceFixture(process.env.PG_CONTRACT_URL);
    try {
      const a = await f.prepare();
      await f.provider.withTransaction(async (tx) => {
        await tx.query("UPDATE stage_meta SET owner_id='new' WHERE owner_id='learner'");
        await tx.query(
          "UPDATE runtime_sessions SET learner_key='new',data=jsonb_set(data,'{learnerKey}',to_jsonb('new'::text)) WHERE learner_key='learner'",
        );
        await rekeyQuizTraceIn(tx, 'learner', 'new');
      });
      await expect(readQuizAttempt(f.provider, 'learner', a.attemptId)).rejects.toMatchObject({
        code: 'ATTEMPT_NOT_FOUND',
      });
      expect((await readQuizAttempt(f.provider, 'new', a.attemptId)).version.id).toBe(a.version.id);
      await f.provider.withTransaction((tx) => deleteQuizTraceIn(tx, 'new', { stageId: 'stage' }));
      for (const table of [
        'quiz_trace_attempts',
        'quiz_trace_operations',
        'quiz_trace_reviews',
        'scene_history_versions',
        'runtime_sessions',
      ])
        expect((await f.db.query('SELECT * FROM ' + table)).rows).toHaveLength(0);
    } finally {
      await f.close();
    }
  });
});
