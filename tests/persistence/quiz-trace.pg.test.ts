import { describe, it, expect } from 'vitest';
import { traceFixture } from './quiz-trace-fixture';
const url = process.env.PG_CONTRACT_URL;
describe.skipIf(!url)('Quiz atomic preparation/submission (real PostgreSQL)', () => {
  it('two Starts bind one actual attempt; two different submissions have one winner', async () => {
    const f = await traceFixture(url);
    try {
      const [a, b] = await Promise.all([f.prepare('start1'), f.prepare('start2')]);
      expect(a.attemptId).toBe(b.attemptId);
      const results = await Promise.allSettled(
        ['A', 'B'].map((answer, i) =>
          f.service.submit('learner', a.attemptId, {
            operationId: 'sub' + i,
            submissionId: 's' + i,
            answers: { q: answer },
          }),
        ),
      );
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(
        (
          await f.db.query(
            "SELECT * FROM runtime_records WHERE data->'payload'->>'phase'='submitted'",
          )
        ).rows,
      ).toHaveLength(1);
    } finally {
      await f.close();
    }
  });
  it('rollback of failed prepare leaves neither a new version nor a runtime', async () => {
    const f = await traceFixture(url);
    try {
      await f.db.query(
        "CREATE FUNCTION fail_binding() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic binding failure'; END $$",
      );
      await f.db.query(
        'CREATE TRIGGER fail_binding BEFORE INSERT ON quiz_trace_attempts FOR EACH ROW EXECUTE FUNCTION fail_binding()',
      );
      await expect(f.prepare()).rejects.toThrow();
      expect((await f.db.query('SELECT * FROM scene_history_versions')).rows).toHaveLength(0);
      expect((await f.db.query('SELECT * FROM runtime_sessions')).rows).toHaveLength(0);
    } finally {
      await f.close();
    }
  });
});

describe.skipIf(!url)('parallel Scene captures sharing an asset', () => {
  it('two different courses prepare with a shared source without blob lock upgrade', async () => {
    const f = await traceFixture(url);
    try {
      const source = await f.provider.assetStore.put(
        { key: 'owner:learner' },
        new Blob(['shared'], { type: 'audio/mpeg' }),
      );
      await f.db.query("INSERT INTO stage_meta VALUES('second','learner',NULL)");
      await f.db.query("INSERT INTO document_scenes VALUES('second','scene','{}'::jsonb)");
      const common = {
        title: 'quiz',
        id: 'scene',
        type: 'quiz' as const,
        order: 0,
        content: {
          type: 'quiz' as const,
          questions: [
            {
              id: 'q',
              type: 'single' as const,
              question: '?',
              options: [{ label: 'yes', value: 'A' }],
              answer: ['A'],
            },
          ],
        },
        actions: [{ id: 's', type: 'speech' as const, text: 'optional', audioId: source }],
      };
      const results = await Promise.all(
        ['stage', 'second'].map((stageId, i) =>
          f.service.prepare('learner', {
            operationId: 'shared-start-' + i,
            mode: 'start',
            stageId,
            sceneId: 'scene',
            scene: { ...common, stageId },
          }),
        ),
      );
      expect(results).toHaveLength(2);
      expect(results.every((r) => r.version.resources.length === 1)).toBe(true);
    } finally {
      await f.close();
    }
  }, 10000);
});
