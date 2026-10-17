import { beforeEach, afterEach, it, expect } from 'vitest';
import { traceFixture, testScene } from './quiz-trace-fixture';
let f: Awaited<ReturnType<typeof traceFixture>>;
beforeEach(async () => {
  f = await traceFixture();
});
afterEach(async () => {
  await f.close();
});
it('captures actual memory content, reuses operation, restores old version after edit', async () => {
  const edited = structuredClone(testScene);
  if (edited.type === 'quiz') edited.content.questions[0].question = 'Unsaved memory V2';
  const a = await f.service.prepare('learner', {
    operationId: 'start',
    mode: 'start',
    stageId: 'stage',
    sceneId: 'scene',
    scene: edited,
  });
  expect(a.version.scene.content).toEqual(edited.content);
  await f.db.query("UPDATE document_scenes SET data='{}'::jsonb");
  const same = await f.service.prepare('learner', {
    operationId: 'start',
    mode: 'start',
    stageId: 'stage',
    sceneId: 'scene',
    scene: edited,
  });
  expect(same.attemptId).toBe(a.attemptId);
  expect(same.version.id).toBe(a.version.id);
  await expect(
    f.service.prepare('learner', {
      operationId: 'start',
      mode: 'start',
      stageId: 'stage',
      sceneId: 'scene',
      scene: testScene,
    }),
  ).rejects.toMatchObject({ code: 'OPERATION_CONFLICT' });
});
it('locks one formal submission and rejects subsequent drafts/answers', async () => {
  const a = await f.prepare();
  const input = { operationId: 'submit', submissionId: 'submission', answers: { q: 'A' } };
  const s = await f.service.submit('learner', a.attemptId, input);
  expect(await f.service.submit('learner', a.attemptId, input)).toEqual(s);
  await expect(
    f.service.submit('learner', a.attemptId, { ...input, answers: { q: 'B' } }),
  ).rejects.toMatchObject({ code: 'OPERATION_CONFLICT' });
  await expect(
    f.service.submit('learner', a.attemptId, {
      operationId: 'other',
      submissionId: 'other',
      answers: { q: 'B' },
    }),
  ).rejects.toMatchObject({ code: 'ANSWERS_LOCKED' });
  await expect(
    f.service.saveDraft('learner', a.attemptId, {
      operationId: 'draft',
      answers: { q: 'B' },
      expectedLastSeq: s.seq,
    }),
  ).rejects.toMatchObject({ code: 'ANSWERS_LOCKED' });
  expect(
    (await f.db.query('SELECT * FROM runtime_records WHERE session_id=$1', [a.attemptId])).rows,
  ).toHaveLength(2);
});
it('CAS drafts do not overwrite newer draft', async () => {
  const a = await f.prepare();
  await f.service.saveDraft('learner', a.attemptId, {
    operationId: 'd1',
    answers: { q: 'A' },
    expectedLastSeq: a.lastSeq,
  });
  await expect(
    f.service.saveDraft('learner', a.attemptId, {
      operationId: 'd2',
      answers: { q: 'B' },
      expectedLastSeq: a.lastSeq,
    }),
  ).rejects.toMatchObject({ code: 'DRAFT_CONFLICT' });
});
it('owner and exact scene authorization prevent cross-owner prepare/submit', async () => {
  const a = await f.prepare();
  await expect(
    f.service.submit('other', a.attemptId, {
      operationId: 'o',
      submissionId: 's',
      answers: { q: 'A' },
    }),
  ).rejects.toMatchObject({ code: 'ATTEMPT_NOT_FOUND' });
  await expect(
    f.service.prepare('other', {
      operationId: 'o',
      mode: 'start',
      stageId: 'stage',
      sceneId: 'scene',
      scene: testScene,
    }),
  ).rejects.toMatchObject({ code: 'STAGE_NOT_FOUND' });
});
it('retry uses original version and reuses only empty actual successor', async () => {
  const a = await f.prepare();
  await f.service.submit('learner', a.attemptId, {
    operationId: 'sub',
    submissionId: 's',
    answers: { q: 'A' },
  });
  const next = await f.service.prepare('learner', {
    operationId: 'retry',
    mode: 'retry',
    stageId: 'stage',
    sceneId: 'scene',
    previousAttemptId: a.attemptId,
  });
  expect(next.attemptId).not.toBe(a.attemptId);
  expect(next.version.id).toBe(a.version.id);
  expect(
    (
      await f.service.prepare('learner', {
        operationId: 'retry2',
        mode: 'retry',
        stageId: 'stage',
        sceneId: 'scene',
        previousAttemptId: a.attemptId,
      })
    ).attemptId,
  ).toBe(next.attemptId);
});

it('rejects predecessor injection on start and retains the real UI outline wrapper', async () => {
  await expect(
    f.service.prepare('learner', {
      operationId: 'bad',
      mode: 'start',
      stageId: 'stage',
      sceneId: 'scene',
      scene: testScene,
      previousAttemptId: 'foreign',
    }),
  ).rejects.toMatchObject({ code: 'INVALID_PREVIOUS_ATTEMPT' });
  const scene = { ...structuredClone(testScene), outlineId: 'outline' };
  const planning = {
    outlineId: 'outline',
    outline: { id: 'outline', keyPoints: ['slope'], teachingObjective: 'explain slope' },
    provenance: 'outline-id-match',
  };
  const a = await f.service.prepare('learner', {
    operationId: 'good',
    mode: 'start',
    stageId: 'stage',
    sceneId: 'scene',
    scene,
    planning,
  });
  expect(a.version.planning).toEqual(planning);
});
