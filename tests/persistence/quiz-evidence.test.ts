import { afterEach, beforeEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { evidenceFixture } from './quiz-evidence-fixture';
import { QuizEvidenceStore } from '@/lib/persistence/quiz-evidence-store';
import { readEvidenceRun, readEvidenceOperation } from '@/lib/persistence/quiz-evidence-read';
let f: Awaited<ReturnType<typeof evidenceFixture>>;
let store: QuizEvidenceStore;
beforeEach(async () => {
  f = await evidenceFixture();
  store = new QuizEvidenceStore(f.provider);
});
afterEach(async () => {
  await f.close();
});
const zero = JSON.stringify({
  schemaVersion: 'quiz-evidence.v1',
  overview: {
    outcome: 'no-new',
    inspectedRefs: [],
    notes: ['No new interpretation'],
    unfinished: [],
  },
  items: [],
});
it.each(['reserved', 'generated'] as const)(
  'does not reuse a restricted %s run for a new operation',
  async (state) => {
    const request = f.request();
    const { run } = await store.reserve('learner', request, f.model, f.settings);
    if (state === 'generated') {
      const claim = await store.claim('learner', run.id);
      if (!claim) throw new Error('Missing invocation claim');
      await store.capture('learner', claim, {
        text: zero,
        finishReason: 'stop',
        usage: {},
        receivedAt: new Date().toISOString(),
        modelIdentity: f.model,
      });
    }
    await store.restrict('learner', run.id, {
      restrictionId: randomUUID(),
      itemIds: [],
      sourceRefs: [],
      code: 'KNOWN_ISSUE',
      reason: 'Explicit source issue',
    });
    await expect(store.reserve('learner', f.request(), f.model, f.settings)).rejects.toMatchObject({
      code: 'EVIDENCE_BUSY',
    });
    const receipts = await f.db.query<{ n: number }>(
      'SELECT count(*)::int n FROM quiz_evidence_requests',
    );
    expect(receipts.rows[0].n).toBe(1);
    expect((await store.lookupRequest('learner', request))?.id).toBe(run.id);
  },
);
async function complete(request = f.request()) {
  const { run } = await store.reserve('learner', request, f.model, f.settings);
  const claim = await store.claim('learner', run.id);
  if (!claim) throw new Error('Missing claim');
  const reply = {
    text: zero,
    finishReason: 'stop',
    usage: {},
    receivedAt: new Date().toISOString(),
    modelIdentity: f.model,
  };
  await store.capture('learner', claim, reply);
  await store.capture('learner', claim, reply); // DB response loss can replay the same captured bytes.
  return store.finalize('learner', run.id);
}
it('pins source and replays canonical receipts, rejecting changed intent', async () => {
  const request = f.request();
  const first = await store.reserve('learner', request, f.model, f.settings);
  expect(await store.lookupRequest('learner', request)).toEqual(first.run);
  await expect(
    store.lookupRequest('learner', { ...request, language: 'en-US' }),
  ).rejects.toMatchObject({ code: 'OPERATION_CONFLICT' });
  expect((await store.reserve('learner', f.request(), f.model, f.settings)).run.id).toBe(
    first.run.id,
  );
  expect(await store.claim('learner', first.run.id)).not.toBeNull();
  expect(await store.claim('learner', first.run.id)).toBeNull();
});
it('saves zero output, resumes generated without a model and reuses completed', async () => {
  const run = await complete();
  expect(run.state).toBe('completed');
  expect(run.delivery?.items).toEqual([]);
  expect((await store.reserve('learner', f.request(), f.model, f.settings)).run.id).toBe(run.id);
  expect((await readEvidenceRun(f.provider, 'learner', run.id)).visibility).toBe('visible');
  expect(run.adoptionAllowed).toBe(false);
});
it('retains deleted receipts and never regenerates deleted operations', async () => {
  const request = f.request();
  const run = await complete(request);
  await store.delete('learner', run.id);
  await expect(store.lookupRequest('learner', request)).rejects.toMatchObject({
    code: 'EVIDENCE_DELETED',
    status: 410,
  });
  await expect(
    readEvidenceOperation(f.provider, 'learner', request.operationId),
  ).rejects.toMatchObject({ status: 410 });
  await store.delete('other', run.id);
});
it('does not retry expired calls and requires explicit same-anchor reanalysis', async () => {
  const request = f.request();
  const { run } = await store.reserve('learner', request, f.model, f.settings);
  const claim = await store.claim('learner', run.id);
  expect(claim).not.toBeNull();
  await f.db.query(
    "UPDATE quiz_evidence_runs SET lease_expires_at=now()-interval '1 second' WHERE id=$1",
    [run.id],
  );
  const view = await readEvidenceRun(f.provider, 'learner', run.id);
  expect(view.visibility === 'visible' && view.effectiveState).toBe('interrupted');
  expect((await store.interrupt('learner', run.id)).state).toBe('interrupted');
  await expect(store.reserve('learner', f.request(), f.model, f.settings)).rejects.toMatchObject({
    code: 'EXECUTION_UNKNOWN',
  });
  const next = await store.reserve(
    'learner',
    f.request({ action: 'reanalyze', previousRunId: run.id }),
    f.model,
    f.settings,
  );
  expect(next.run.id).not.toBe(run.id);
});
it('restrict is idempotent, rejects invalid dependencies, and prevents new exact reuse', async () => {
  const run = await complete();
  const value = {
    restrictionId: randomUUID(),
    itemIds: [],
    code: 'SEMANTIC_RECHECK',
    reason: 'Requires review',
    sourceRefs: [],
  };
  expect((await store.restrict('learner', run.id, value)).restrictions).toHaveLength(1);
  expect((await store.restrict('learner', run.id, value)).restrictions).toHaveLength(1);
  await expect(
    store.restrict('learner', run.id, { ...value, reason: 'Changed' }),
  ).rejects.toMatchObject({ code: 'RESTRICTION_CONFLICT' });
  expect((await store.reserve('learner', f.request(), f.model, f.settings)).run.id).not.toBe(
    run.id,
  );
});
it('hides every captured payload if any selected source is unavailable', async () => {
  const run = await complete();
  const marker = 'DELETED_SOURCE_PRIVATE_CONTENT';
  run.context.text = marker;
  run.reply!.text = marker;
  run.errorCode = marker;
  run.sourceEnvelope.anchor.version.scene.title = marker;
  run.delivery!.errors = [marker];
  run.delivery!.rejected = [{ index: 4, codes: [marker] }];
  run.delivery!.items = [
    {
      index: 0,
      topic: marker,
      taskScope: marker,
      observations: [marker],
      interpretation: marker,
      limitations: [marker],
      pairs: [],
      citations: [],
      conditionRefs: [],
      submissionIds: [],
      conditions: [],
    },
  ];
  await f.db.query('UPDATE quiz_evidence_runs SET data=$2::jsonb WHERE id=$1', [
    run.id,
    JSON.stringify(run),
  ]);
  await f.db.query('DELETE FROM quiz_trace_attempts WHERE id=$1', [f.source.attemptId]);
  const view = await readEvidenceRun(f.provider, 'learner', run.id);
  expect(view).toEqual({
    runId: run.id,
    state: 'completed',
    visibility: 'source-unavailable',
    reasonCode: 'SOURCE_UNAVAILABLE',
    semanticStatus: 'unreviewed',
    adoptionAllowed: false,
  });
  expect(JSON.stringify(view)).not.toContain('Synthetic');
  expect(JSON.stringify(view)).not.toContain(marker);
  expect(
    JSON.stringify(await readEvidenceOperation(f.provider, 'learner', run.request.operationId)),
  ).not.toContain(marker);
  await expect(readEvidenceRun(f.provider, 'other', run.id)).rejects.toMatchObject({ status: 404 });
});
it('preserves partial rejected items, original indexes and unfinished scope through reuse', async () => {
  const request = f.request();
  const { run } = await store.reserve('learner', request, f.model, f.settings);
  const task = Object.values(run.context.sourceIndex).find((x) => x.role === 'task')!;
  const answer = Object.values(run.context.sourceIndex).find((x) => x.role === 'answer')!;
  const item = {
    topic: 'Choice',
    taskScope: 'One historical task',
    observations: ['Selected A'],
    interpretation: 'This submission selected the expected option',
    limitations: ['Controlled proxy'],
    pairs: [{ taskRef: task.ref, answerRef: answer.ref }],
    citations: [{ ref: task.ref }, { ref: answer.ref }],
    conditionRefs: [],
  };
  const output = {
    schemaVersion: 'quiz-evidence.v1',
    overview: {
      outcome: 'formed',
      inspectedRefs: [task.ref, answer.ref],
      notes: [],
      unfinished: ['Second item is malformed'],
    },
    items: [item, { ...item, citations: [{ ref: 'missing-source' }] }, item],
  };
  const claim = await store.claim('learner', run.id);
  if (!claim) throw new Error('claim');
  await store.capture('learner', claim, {
    text: JSON.stringify(output),
    finishReason: 'stop',
    usage: {},
    receivedAt: new Date().toISOString(),
    modelIdentity: f.model,
  });
  const saved = await store.finalize('learner', run.id);
  expect(saved.state).toBe('partial');
  expect(saved.delivery?.items.map((x) => x.itemId)).toEqual([`${run.id}:0`, `${run.id}:2`]);
  expect(saved.delivery?.rejected).toHaveLength(1);
  const reused = await store.reserve('learner', f.request(), f.model, f.settings);
  expect(reused.kind).toBe('existing');
  expect(reused.run).toEqual(saved);
  expect(reused.run.delivery?.overview?.unfinished).toEqual(['Second item is malformed']);
});
it('does not alter saved source when a new evaluation is added and never requires old provenance on replay', async () => {
  const request = f.request();
  const run = await complete(request);
  const review = await f.service.beginReview('learner', f.source.attemptId, {
    operationId: 'review',
    submissionId: 'submission',
    language: 'en-US',
  });
  await f.service.finishReview('learner', review, {
    results: [
      {
        questionId: 'q',
        correct: true,
        status: 'correct',
        earned: 2,
        evaluation: { state: 'normal', method: 'exact-key' },
      },
    ],
    summary: {
      status: 'complete',
      usableEarned: 2,
      usablePossible: 2,
      quizPossible: 2,
      unusableQuestionCount: 0,
    },
  });
  const replay = await store.lookupRequest('learner', request);
  expect(replay?.sourceEnvelope.anchor.reviews).toHaveLength(0);
  const view = await readEvidenceOperation(f.provider, 'learner', request.operationId);
  expect(
    view.visibility === 'visible' &&
      view.sourceChanges.some((x) => x.code === 'AVAILABLE_NOT_INCLUDED'),
  ).toBe(true);
  const next = await store.reserve('learner', f.request(), f.model, f.settings);
  expect(next.run.id).not.toBe(run.id);
  expect(next.run.sourceEnvelope.anchor.reviews).toHaveLength(1);
});
it('rejects all unavailable selected sources before reserving and prevents capture after Stage deletion', async () => {
  await expect(
    store.reserve(
      'learner',
      f.request({ related: [{ attemptId: 'missing', submissionId: 'missing' }] }),
      f.model,
      f.settings,
    ),
  ).rejects.toBeDefined();
  expect((await f.db.query('SELECT id FROM quiz_evidence_runs')).rows).toHaveLength(0);
  const { run } = await store.reserve('learner', f.request(), f.model, f.settings);
  const claim = await store.claim('learner', run.id);
  if (!claim) throw new Error('claim');
  await f.db.query("UPDATE stage_meta SET deleted_at=now() WHERE stage_id='stage'");
  await expect(
    store.capture('learner', claim, {
      text: zero,
      finishReason: 'stop',
      usage: {},
      receivedAt: new Date().toISOString(),
      modelIdentity: f.model,
    }),
  ).rejects.toMatchObject({ status: 404 });
  expect(
    (await f.db.query('SELECT state FROM quiz_evidence_runs WHERE id=$1', [run.id])).rows[0].state,
  ).toBe('calling');
});
it('explicitly supersedes only a still-reserved previous run without claiming an unknown paid call', async () => {
  const { run } = await store.reserve('learner', f.request(), f.model, f.settings);
  const next = await store.reserve(
    'learner',
    f.request({ action: 'reanalyze', previousRunId: run.id }),
    { ...f.model, model: 'changed' },
    f.settings,
  );
  expect(next.run.previousRunId).toBe(run.id);
  expect((await store.lookupRequest('learner', run.request))?.errorCode).toBe(
    'SUPERSEDED_BEFORE_CALL',
  );
  expect(await store.claim('learner', run.id)).toBeNull();
  await store.claim('learner', next.run.id);
  await expect(
    store.reserve(
      'learner',
      f.request({ action: 'reanalyze', previousRunId: next.run.id }),
      f.model,
      f.settings,
    ),
  ).rejects.toMatchObject({ code: 'EVIDENCE_BUSY' });
});
