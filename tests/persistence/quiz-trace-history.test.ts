import { it, expect } from 'vitest';
import { traceFixture } from './quiz-trace-fixture';
import { readQuizHistory, readQuizAttempt } from '@/lib/persistence/quiz-trace-read';
import { guardQuizRuntime } from '@/lib/persistence/quiz-runtime-guard';
it('reads multi-attempt history without changing records; keeps legacy missing version and multi-submits', async () => {
  const f = await traceFixture();
  try {
    const a = await f.prepare();
    await f.service.submit('learner', a.attemptId, {
      operationId: 's',
      submissionId: 's',
      answers: { q: 'A' },
    });
    const now = new Date().toISOString();
    const store = f.provider.runtimeStore;
    await store.createSession({
      id: 'legacy',
      kind: 'quizAttempt',
      stageId: 'stage',
      learnerKey: 'learner',
      status: 'active',
      createdAt: now,
      updatedAt: now,
    });
    for (const answer of ['A', 'B'])
      await store.appendRecord({
        id: crypto.randomUUID(),
        sessionId: 'legacy',
        sceneId: 'scene',
        createdAt: now,
        payload: { payloadVersion: 1, phase: 'submitted', answers: { q: answer } },
      });
    const before = (await f.db.query('SELECT * FROM runtime_records ORDER BY session_id,seq')).rows;
    const history = await readQuizHistory(f.provider, 'learner', 'stage');
    expect(history.attempts).toHaveLength(1);
    expect(history.legacy[0].records).toHaveLength(2);
    expect(history.legacy[0].missing).toEqual(['historical-question-version']);
    expect(
      (await f.db.query('SELECT * FROM runtime_records ORDER BY session_id,seq')).rows,
    ).toEqual(before);
    await expect(readQuizAttempt(f.provider, 'other', a.attemptId)).rejects.toMatchObject({
      code: 'ATTEMPT_NOT_FOUND',
    });
    await expect(
      guardQuizRuntime(store, f.db).appendRecord({
        id: 'evil',
        sessionId: a.attemptId,
        createdAt: now,
        payload: { phase: 'submitted', answers: { q: 'B' } },
      }),
    ).rejects.toMatchObject({ code: 'QUIZ_TRACE_MANAGED' });
  } finally {
    await f.close();
  }
});
it('known corrupt runtime rows produce partial completeness, not silent omission', async () => {
  const f = await traceFixture();
  try {
    await f.prepare();
    await f.db.query(
      "INSERT INTO runtime_sessions VALUES('corrupt','stage','learner','quizAttempt','active','bad','bad','{}'::jsonb)",
    );
    const h = await readQuizHistory(f.provider, 'learner', 'stage');
    expect(h.completeness).toBe('partial');
    expect(h.failures).toContainEqual({ attemptId: 'corrupt', code: 'UNREADABLE_ATTEMPT' });
  } finally {
    await f.close();
  }
});
