import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import {
  dialogueMemoryFixture,
  memoryModel,
  controlledMemoryReply,
} from './dialogue-memory-fixture';
import { versionSource } from '@/lib/learner-memory/contracts';
const url = process.env.PG_CONTRACT_URL;
if (!url && process.env.STORAGE_PG_CONTRACT_REQUIRED === '1')
  throw Error('F74 requires PG_CONTRACT_URL');
describe.skipIf(!url)('F74 source and Memory lifecycle', () => {
  let f: Awaited<ReturnType<typeof dialogueMemoryFixture>>;
  beforeEach(async () => {
    f = await dialogueMemoryFixture(url!);
  });
  afterEach(async () => {
    await f?.close();
  });
  const prepare = () => f.service.prepare('owner', f.request(), memoryModel);
  it('restricts adopted Dialogue on Evidence deletion, without clearing unrelated Memory', async () => {
    const d = await prepare();
    await f.service.update('owner', d.delivery.id, memoryModel, async (run) =>
      controlledMemoryReply(run),
    );
    await f.store.delete('owner', f.evidence.id);
    expect((await f.service.read('owner', d.delivery.id)).delivery.state).toBe('revoked');
    const view = await f.memory.read('A');
    expect(view.usable.pieces).toHaveLength(0);
    expect(view.maintenancePending).toBe(true);
    expect(view.snapshot.pieces).toHaveLength(1);
    await expect(prepare()).rejects.toMatchObject({ code: 'DIALOGUE_NOT_AVAILABLE' });
  });
  it('blocks in-flight deletion before adoption, without further model invocation', async () => {
    const d = await prepare();
    let calls = 0;
    const result = await f.service.update('owner', d.delivery.id, memoryModel, async (run) => {
      calls++;
      const reply = controlledMemoryReply(run);
      await f.store.delete('owner', f.evidence.id);
      return reply;
    });
    expect(result.delivery.state).toBe('revoked');
    expect(calls).toBe(1);
    expect((await f.memory.read('A')).usable.pieces).toHaveLength(0);
  });
  it('recovers only pending deferred sources and does not automatically retry', async () => {
    const d = await prepare();
    let calls = 0;
    await f.service.update('owner', d.delivery.id, memoryModel, async (run) => {
      calls++;
      return controlledMemoryReply(run, 'defer');
    });
    const retry = await f.service.recover('owner', d.delivery.id, {
      action: 'retry_deferred',
      operationId: 'reconsider',
    });
    expect(retry.delivery.state).toBe('prepared');
    expect(calls).toBe(1);
    await f.service.update('owner', retry.delivery.id, memoryModel, async (run) => {
      calls++;
      return controlledMemoryReply(run);
    });
    expect(calls).toBe(2);
  });
  it('rejects unrelated pending sources and never truncates the allowed batch', async () => {
    await f.memory.ingest('A', [
      versionSource({
        id: 'sim:A:unrelated',
        kind: 'quiz_evidence',
        text: 'other',
        refs: ['quiz:other'],
        conditions: [],
        sourceNature: 'synthetic',
        occurredAt: null,
        provenance: { file: 'control', sha256: 'a'.repeat(64), pointer: '/0' },
      }),
    ]);
    await expect(prepare()).rejects.toMatchObject({ code: 'MEMORY_PENDING_SOURCES' });
    expect(
      (await f.memoryDb.query('SELECT source_id FROM learner_memory_sources WHERE processed=false'))
        .rows,
    ).toHaveLength(1);
  });
  it('does not mistake a reset target for a completed delivery', async () => {
    const d = await prepare();
    await f.service.update('owner', d.delivery.id, memoryModel, async (run) =>
      controlledMemoryReply(run),
    );
    await f.memory.reset('A');
    await expect(f.service.read('owner', d.delivery.id)).rejects.toMatchObject({
      code: 'TARGET_RESET',
    });
    await expect(prepare()).rejects.toMatchObject({ code: 'TARGET_RESET' });
  });
  it('keeps the real Quiz handoff working after Dialogue adoption in the shared Memory', async () => {
    const d = await prepare();
    await f.service.update('owner', d.delivery.id, memoryModel, async (run) =>
      controlledMemoryReply(run),
    );
    const { evidenceFixture } = await import('./quiz-evidence-fixture');
    const q = await evidenceFixture(url!);
    try {
      const { QuizShortFactsService, ensureShortFactsSchema } =
        await import('@/lib/server/quiz-short-facts');
      await q.db.query(
        'CREATE TABLE generation_runs(id TEXT PRIMARY KEY,owner_id TEXT,stage_id TEXT,input JSONB)',
      );
      await q.db.query('CREATE TABLE generation_run_steps(run_id TEXT,step_id TEXT,output JSONB)');
      await q.db.query(
        `INSERT INTO generation_runs VALUES('quiz-run','learner','stage','{"simulatedLearner":"A"}')`,
      );
      await q.db.query(
        `INSERT INTO generation_run_steps VALUES('quiz-run','scene:0:narration','{"scene":{"id":"scene"}}')`,
      );
      await ensureShortFactsSchema(q.db);
      const service = new QuizShortFactsService(q.provider.withTransaction);
      const prepared = await service.prepare({
        owner: 'learner',
        generationRunId: 'quiz-run',
        attemptId: q.source.attemptId,
        submissionId: 'submission',
        student: 'A',
        sourceNature: 'synthetic',
        conditions: ['controlled Quiz coexistence'],
        memoryEnvironmentId: f.settings.memoryEnvironmentId,
      });
      const ref = Object.keys(prepared.context.refs)[0];
      await service.extract('learner', prepared.id, async () => ({
        text: JSON.stringify({
          facts: [{ type: 'correct_performance', evidence: '在给定选项中选择A。', refs: [ref] }],
        }),
        finishReason: 'stop',
        model: 'control',
        usage: null,
      }));
      const result = await service.handoff('learner', prepared.id, f.memory, async (run) =>
        controlledMemoryReply(run),
      );
      expect(result.update!.run.state).toBe('completed');
      const view = await f.memory.read('A');
      const kinds = view.sections.learning_experiences.flatMap((p) =>
        p.supports.map((s) => s.kind),
      );
      expect(kinds).toContain('dialogue_evidence');
      expect(kinds).toContain('quiz_evidence');
    } finally {
      await q.close();
    }
  });
  it('requires the same student even for a formally valid source', async () => {
    const d = await prepare(),
      source = d.delivery.sources[0];
    await expect(f.memory.ingest('B', [source])).rejects.toMatchObject({
      code: 'SIMULATED_SOURCE_STUDENT_MISMATCH',
    });
  });
});
