import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GET, PUT } from '@/app/api/learner-profiles/[profileId]/memory/route';
import {
  GET as GET_BASIS,
  PATCH,
} from '@/app/api/learner-profiles/[profileId]/memory/[itemId]/route';
import { bindLearnerProfileIn } from '@/lib/persistence/learner-profiles';
import { QuizTraceService } from '@/lib/persistence/quiz-trace';
import { readQuizAttempt } from '@/lib/persistence/quiz-trace-read';
import { getOwnerScopedDocumentStore } from '@/lib/server/agent-runtime/owner-scoped-documents';
import { generationRunPersistence } from '@/lib/server/generation/run/store';
import {
  assertInteractiveProfileMemoryCurrent,
  buildInteractiveProfileMemory,
} from '@/lib/server/generation/run/interactive-profile-memory';
import { editProfileMemory, readProfileMemory } from '@/lib/server/learner-profile-memory';
import { QuizFeedbackService } from '@/lib/server/quiz-feedback';
import { QuizPracticeService } from '@/lib/server/quiz-practice';
import {
  discoverProfileMemory,
  processProfileMemory,
} from '@/lib/server/learner-profile-memory-runner';
import type { ChatSession } from '@/lib/types/chat';
import { saveChatSessions } from '@/lib/utils/chat-storage';
import { testScene } from '../persistence/quiz-trace-fixture';

const pgUrl = process.env.PG_CONTRACT_URL;

describe.skipIf(!pgUrl)('F93 formal profile memory in PostgreSQL', () => {
  const schema = 'f93_' + randomUUID().replaceAll('-', '');
  const cookie = randomUUID();
  const foreign = randomUUID();
  const owner = 'anon:' + cookie;
  const previousUrl = process.env.DATABASE_URL;
  let admin: Pool;
  let app: Awaited<ReturnType<typeof generationRunPersistence>>;

  beforeAll(async () => {
    admin = new Pool({ connectionString: pgUrl });
    await admin.query('CREATE SCHEMA ' + schema);
    const url = new URL(pgUrl!);
    url.searchParams.set('options', '-c search_path=' + schema);
    process.env.DATABASE_URL = url.href;
    app = await generationRunPersistence();
  });
  afterAll(async () => {
    if (previousUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousUrl;
    await app?.pool.end();
    await admin?.query('DROP SCHEMA IF EXISTS ' + schema + ' CASCADE');
    await admin?.end();
  });

  async function prepareClassroom(
    stageId: string,
    withProfile: boolean,
    interactiveMode = false,
    taskEngineMode = false,
  ) {
    const store = await getOwnerScopedDocumentStore(owner);
    const now = Date.now();
    const scene = { ...testScene, stageId };
    await store.saveDocument({
      stage: {
        id: stageId,
        name: stageId,
        createdAt: now,
        updatedAt: now,
        interactiveMode,
        taskEngineMode,
      },
      scenes: [scene],
    });
    const profile = withProfile
      ? await app.withTransaction(async (tx) => {
          await bindLearnerProfileIn(tx, {
            stageId,
            runId: randomUUID(),
            selection: { mode: 'blank', requestId: randomUUID() },
          });
          return (
            await tx.query<{ profile_id: string }>(
              'SELECT profile_id FROM classroom_learner_profiles WHERE stage_id=$1',
              [stageId],
            )
          ).rows[0].profile_id;
        })
      : null;
    return { stageId, scene, profile };
  }

  async function submitQuiz(
    classroom: Awaited<ReturnType<typeof prepareClassroom>>,
    reviewed = true,
  ) {
    const quiz = new QuizTraceService(app);
    const attempt = await quiz.prepare(owner, {
      operationId: randomUUID(),
      mode: 'start',
      stageId: classroom.stageId,
      sceneId: classroom.scene.id,
      scene: classroom.scene,
    });
    const submissionId = randomUUID();
    await quiz.submit(owner, attempt.attemptId, {
      operationId: randomUUID(),
      submissionId,
      answers: { q: 'B' },
    });
    if (reviewed) await reviewQuiz(attempt.attemptId, submissionId, false);
    return attempt;
  }

  async function reviewQuiz(attemptId: string, submissionId: string, correct: boolean) {
    const quiz = new QuizTraceService(app);
    const review = await quiz.beginReview(owner, attemptId, {
      operationId: randomUUID(),
      submissionId,
      language: 'zh-CN',
    });
    await quiz.finishReview(owner, review, {
      results: [
        {
          questionId: 'q',
          correct,
          status: correct ? 'correct' : 'incorrect',
          earned: correct ? 2 : 0,
          evaluation: { state: 'normal', method: 'exact-key' },
        },
      ],
      summary: {
        status: 'complete',
        usableEarned: correct ? 2 : 0,
        usablePossible: 2,
        quizPossible: 2,
        unusableQuestionCount: 0,
      },
    });
    return review;
  }

  const preference = '以后学化学时，我希望先看一个具体例子。';
  async function saveDiscussionAndQA(stageId: string) {
    const now = Date.now();
    const common = {
      config: { agentIds: ['teacher'] },
      toolCalls: [],
      pendingToolCalls: [],
      createdAt: now,
      updatedAt: now,
      initialContext: { stageId, stageTitle: stageId, sceneId: 'scene' },
    };
    const sessions: ChatSession[] = [
      {
        ...common,
        id: 'discussion',
        title: 'Density exercise',
        type: 'discussion',
        status: 'completed',
        messages: [
          {
            id: 'teacher-hint',
            role: 'assistant',
            parts: [{ type: 'text', text: '提示：把质量除以体积。' }],
          },
          {
            id: 'learner-answer',
            role: 'user',
            parts: [{ type: 'text', text: '用 54 除以 20，密度是 2.7。' }],
          },
        ],
      },
      {
        ...common,
        id: 'qa',
        title: 'Teaching preference',
        type: 'qa',
        status: 'active',
        messages: [
          { id: 'learner-preference', role: 'user', parts: [{ type: 'text', text: preference }] },
          { id: 'one-off', role: 'user', parts: [{ type: 'text', text: '这道题先不要画图。' }] },
        ],
      },
    ];
    await saveChatSessions(stageId, sessions, {
      store: app.runtimeStore,
      learnerKey: owner,
      legacyStore: { load: async () => [], clear: async () => undefined },
    });
  }

  it('updates only the bound profiles, preserves edits and source conditions, and rejects other owners', async () => {
    const physics = await prepareClassroom('Physics', true);
    const chemistry = await prepareClassroom('Chemistry', true);
    const unbound = await prepareClassroom('No-profile', false);
    const deep = await prepareClassroom('Deep', true, true);
    const physicsId = physics.profile!;
    const chemistryId = chemistry.profile!;
    const original = await readProfileMemory(owner, physicsId);
    expect(original.items).toEqual([]);
    const physicsQuiz = await submitQuiz(physics);
    const unboundQuiz = await submitQuiz(unbound);
    await saveDiscussionAndQA(chemistry.stageId);
    await saveDiscussionAndQA(unbound.stageId);
    await saveDiscussionAndQA(deep.stageId);
    await Promise.all([discoverProfileMemory(app), discoverProfileMemory(app)]);
    expect(
      (await app.pool.query('SELECT kind FROM learner_profile_memory_jobs ORDER BY kind')).rows,
    ).toEqual([{ kind: 'discussion' }, { kind: 'qa' }, { kind: 'qa' }, { kind: 'quiz' }]);

    let quizCalls = 0;
    let observedEdit = false;
    const update = {
      revision: original.fields.revision,
      name: '物理',
      background: '初二',
      goals: '准备期末复习',
      preferences: '先看例题',
    };
    const invoke: Parameters<typeof processProfileMemory>[1] = async (
      sourceOwner,
      system,
      input,
    ) => {
      expect(sourceOwner).toBe(owner);
      expect(system).toContain('教师的话不得归给学生');
      const { kind, parts } = JSON.parse(input);
      expect(input).not.toContain(update.preferences);
      if (kind === 'quiz') {
        quizCalls++;
        expect(parts[0].review).toBe('incorrect');
        if (quizCalls === 1) throw new Error('recoverable fixture failure');
        const saved = await editProfileMemory(owner, physicsId, update);
        observedEdit = saved?.fields.preferences === update.preferences;
        return JSON.stringify({
          records: [
            {
              section: 'experiences',
              summary: '选择题作答 B，正常评阅为错误，帮助情况未确认。',
              refs: [0],
            },
          ],
        });
      }
      if (kind === 'discussion') {
        expect(parts[0].previous).toEqual([{ role: 'teacher', text: '提示：把质量除以体积。' }]);
        return JSON.stringify({
          records: [
            { section: 'experiences', summary: '听到公式提示后，给出 54 ÷ 20 = 2.7。', refs: [0] },
          ],
        });
      }
      return JSON.stringify({
        records:
          parts[0].answer === preference
            ? [{ section: 'preferences', summary: preference, refs: [0] }]
            : [],
      });
    };
    for (let i = 0; i < 4; i++) expect(await processProfileMemory(app, invoke)).toBe(true);
    expect(await processProfileMemory(app, invoke)).toBe(false);
    expect((await readProfileMemory(owner, physicsId)).items).toEqual([]);
    await app.pool.query("UPDATE learner_profile_memory_jobs SET ready_at=now() WHERE kind='quiz'");
    expect(await processProfileMemory(app, invoke)).toBe(true);
    expect(observedEdit).toBe(true);
    await discoverProfileMemory(app);
    expect(await processProfileMemory(app, invoke)).toBe(false);
    expect(quizCalls).toBe(2);
    expect(
      (
        await app.pool.query(
          'SELECT id FROM quiz_trace_attempts WHERE id=$1 AND submission IS NOT NULL',
          [unboundQuiz.attemptId],
        )
      ).rows,
    ).toHaveLength(1);
    expect(
      (
        await app.pool.query("SELECT id FROM runtime_sessions WHERE stage_id=$1 AND kind='chat'", [
          unbound.stageId,
        ])
      ).rows,
    ).toHaveLength(2);

    const request = (
      method: string,
      profileId: string,
      identity = cookie,
      body?: unknown,
      site = 'same-origin',
    ) =>
      new NextRequest(`http://localhost/api/learner-profiles/${profileId}/memory`, {
        method,
        headers: {
          cookie: 'anonymous_id=' + identity,
          'sec-fetch-site': site,
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    const context = (profileId: string) => ({ params: Promise.resolve({ profileId }) });
    const read = await GET(request('GET', physicsId), context(physicsId));
    expect(read.headers.get('cache-control')).toBe('private, no-store');
    const saved = await read.json();
    expect(saved.profile.name).toBe('物理');
    expect(saved.fields).toMatchObject({
      background: '初二',
      goals: '准备期末复习',
      preferences: '先看例题',
    });
    expect(saved.items).toHaveLength(1);
    const chemistryView = await readProfileMemory(owner, chemistryId);
    expect(chemistryView.items.map((i) => i.kind).sort()).toEqual(['discussion', 'qa']);
    expect((await readProfileMemory(owner, deep.profile!)).items).toEqual([]);
    expect(
      await buildInteractiveProfileMemory(
        owner,
        { profileId: deep.profile!, task: '密度', content: {} },
        async () => {
          throw new Error('An empty profile should not need a selector call');
        },
      ),
    ).toEqual({ profileId: deep.profile, selected: [] });
    const selected = await buildInteractiveProfileMemory(
      owner,
      {
        profileId: chemistryId,
        task: '复习密度',
        content: { pdfText: '本课包括质量和体积。' },
      },
      async ({ user }) => {
        expect(user).not.toContain(chemistryId);
        expect(user).not.toContain('用 54 除以 20，密度是 2.7。');
        expect(user).not.toContain('提示：把质量除以体积。');
        const payload = JSON.parse(user);
        expect(payload).toMatchObject({
          task: '复习密度',
          content: { pdfText: '本课包括质量和体积。' },
        });
        expect(payload.memory).toHaveLength(2);
        return JSON.stringify({
          selected: [
            payload.memory.find((item: { source: string }) => item.source === 'discussion').id,
          ],
        });
      },
    );
    expect(selected.selected).toMatchObject([
      { source: 'discussion', conditions: [{ help: 'prior-teacher-messages' }] },
    ]);
    await assertInteractiveProfileMemoryCurrent(owner, selected);
    expect((await PUT(request('PUT', physicsId, cookie, update), context(physicsId))).status).toBe(
      409,
    );
    expect((await GET(request('GET', physicsId, foreign), context(physicsId))).status).toBe(404);
    expect((await PUT(request('PUT', physicsId, foreign, update), context(physicsId))).status).toBe(
      404,
    );
    expect(
      (await PUT(request('PUT', physicsId, cookie, update, 'cross-site'), context(physicsId)))
        .status,
    ).toBe(403);
    const itemId = saved.items[0].id as string;
    const itemContext = (profileId: string, id = itemId) => ({
      params: Promise.resolve({ profileId, itemId: id }),
    });
    expect((await GET_BASIS(request('GET', chemistryId), itemContext(chemistryId))).status).toBe(
      404,
    );
    expect(
      (await GET_BASIS(request('GET', physicsId, foreign), itemContext(physicsId))).status,
    ).toBe(404);
    const quizBasis = await (
      await GET_BASIS(request('GET', physicsId), itemContext(physicsId))
    ).json();
    expect(quizBasis).toMatchObject({
      title: 'Physics',
      historicalReview: false,
      parts: [
        { question: 'Synthetic question V1', answer: 'B', review: 'incorrect', help: 'unknown' },
      ],
    });
    const originalQuiz = await readQuizAttempt(app, owner, physicsQuiz.attemptId);
    const quizService = new QuizTraceService(app);
    const newerReview = await quizService.beginReview(owner, physicsQuiz.attemptId, {
      operationId: randomUUID(),
      submissionId: originalQuiz.submission!.id,
      language: 'zh-CN',
    });
    await quizService.finishReview(owner, newerReview, {
      results: originalQuiz.review!.results.map((result) => ({
        ...result,
        correct: true,
        status: 'correct',
        earned: 2,
      })),
      summary: originalQuiz.review!.summary,
    });
    const regradedQuiz = await readQuizAttempt(app, owner, physicsQuiz.attemptId);
    expect(regradedQuiz.review?.id).toBe(newerReview.id);
    expect(regradedQuiz.review?.results[0].correct).toBe(true);
    const historical = await GET_BASIS(request('GET', physicsId), itemContext(physicsId));
    expect(historical.status).toBe(200);
    expect(await historical.json()).toEqual({ ...quizBasis, historicalReview: true });
    await discoverProfileMemory(app);
    expect(await processProfileMemory(app, invoke)).toBe(false);
    expect((await readProfileMemory(owner, physicsId)).items).toHaveLength(1);
    const discussionId = chemistryView.items.find((i) => i.kind === 'discussion')!.id;
    const discussionBasis = await (
      await GET_BASIS(request('GET', chemistryId), itemContext(chemistryId, discussionId))
    ).json();
    expect(discussionBasis.parts[0]).toMatchObject({
      help: 'prior-teacher-messages',
      answer: '用 54 除以 20，密度是 2.7。',
      previous: [{ text: '提示：把质量除以体积。' }],
    });
    expect(
      (
        await PATCH(
          request('PATCH', chemistryId, cookie, { flagged: true }),
          itemContext(chemistryId, discussionId),
        )
      ).status,
    ).toBe(204);
    await expect(assertInteractiveProfileMemoryCurrent(owner, selected)).rejects.toMatchObject({
      code: 'LEARNER_CONTEXT_INVALID',
    });
    const afterFlag = await buildInteractiveProfileMemory(
      owner,
      {
        profileId: chemistryId,
        task: '复习密度',
        content: {},
      },
      async ({ user }) => {
        expect(JSON.parse(user).memory.map((item: { source: string }) => item.source)).toEqual([
          'qa',
        ]);
        return '{"selected":[]}';
      },
    );
    expect(afterFlag.selected).toEqual([]);
    for (let repeat = 0; repeat < 2; repeat++) {
      expect(
        (
          await PATCH(
            request('PATCH', physicsId, cookie, { flagged: true }),
            itemContext(physicsId),
          )
        ).status,
      ).toBe(204);
    }
    expect((await readProfileMemory(owner, physicsId)).items[0].flagged).toBe(true);
    expect((await readQuizAttempt(app, owner, physicsQuiz.attemptId)).submission?.answers).toEqual({
      q: 'B',
    });
    expect((await GET_BASIS(request('GET', physicsId), itemContext(physicsId))).status).toBe(200);
    await app.pool.query("UPDATE stage_meta SET deleted_at=now() WHERE stage_id='Physics'");
    expect((await GET_BASIS(request('GET', physicsId), itemContext(physicsId))).status).toBe(404);
    expect((await readProfileMemory(owner, physicsId)).items).toEqual([]);
  }, 30_000);

  it('discovers a previously reviewed deep-interaction quiz for its bound profile', async () => {
    const deep = await prepareClassroom('Deep-reviewed-quiz', true, true);
    const { attemptId } = await submitQuiz(deep);
    const original = await readQuizAttempt(app, owner, attemptId);
    const profileId = deep.profile!;
    const { fields, maintenance } = await readProfileMemory(owner, profileId);
    expect(maintenance.pending).toBe(false);
    expect(original.review?.results[0]).toMatchObject({ correct: false, status: 'incorrect' });
    const edited = {
      name: '深度课堂画像',
      background: '正在复习',
      goals: '练习换算',
      preferences: '先做一道例题',
    };
    await editProfileMemory(owner, profileId, { revision: fields.revision, ...edited });

    await Promise.all([discoverProfileMemory(app), discoverProfileMemory(app)]);
    expect((await readProfileMemory(owner, profileId)).maintenance.pending).toBe(true);
    expect(
      await processProfileMemory(app, async () => {
        throw new Error('Retryable model fixture failure');
      }),
    ).toBe(true);
    expect(await readProfileMemory(owner, profileId)).toMatchObject({
      items: [],
      maintenance: { pending: true, failed: false },
    });
    await app.pool.query(
      'UPDATE learner_profile_memory_jobs SET ready_at=now() WHERE stage_id=$1',
      [deep.stageId],
    );

    const summary = '这次在选择题作答 B，正常评阅为错误，帮助情况未确认。';
    const invoke: Parameters<typeof processProfileMemory>[1] = async (
      sourceOwner,
      _system,
      input,
    ) => {
      expect(sourceOwner).toBe(owner);
      expect(input).not.toContain(edited.preferences);
      expect(JSON.parse(input)).toMatchObject({
        kind: 'quiz',
        parts: [
          { question: 'Synthetic question V1', answer: 'B', review: 'incorrect', help: 'unknown' },
        ],
      });
      return JSON.stringify({ records: [{ section: 'experiences', summary, refs: [0] }] });
    };
    expect(await processProfileMemory(app, invoke)).toBe(true);
    const saved = await readProfileMemory(owner, profileId);
    expect(saved).toMatchObject({
      profile: { id: profileId, name: edited.name },
      fields: {
        background: edited.background,
        goals: edited.goals,
        preferences: edited.preferences,
      },
      items: [{ kind: 'quiz', section: 'experiences', summary }],
      maintenance: { pending: false, failed: false },
    });
    const itemId = saved.items[0].id;
    const basis = (identity = cookie) =>
      GET_BASIS(
        new NextRequest(`http://localhost/api/learner-profiles/${profileId}/memory/${itemId}`, {
          headers: { cookie: 'anonymous_id=' + identity },
        }),
        { params: Promise.resolve({ profileId, itemId }) },
      );
    const response = await basis();
    expect(response.status).toBe(200);
    const source = await response.json();
    expect(source).toMatchObject({
      title: deep.stageId,
      historicalReview: false,
      parts: [
        { question: 'Synthetic question V1', answer: 'B', review: 'incorrect', help: 'unknown' },
      ],
    });
    expect((await basis(foreign)).status).toBe(404);

    const newer = await reviewQuiz(attemptId, original.submission!.id, true);
    const rereviewed = await readQuizAttempt(app, owner, attemptId);
    expect(rereviewed.review?.id).toBe(newer.id);
    expect(rereviewed.submission).toEqual(original.submission);
    await discoverProfileMemory(app);
    expect(await processProfileMemory(app, invoke)).toBe(false);
    expect(await (await basis()).json()).toEqual({ ...source, historicalReview: true });
    expect(await readProfileMemory(owner, profileId)).toEqual(saved);
  });

  it('distinguishes no eligible deep-interaction source from a finished run with no adopted records', async () => {
    const vocational = await prepareClassroom('Deep-vocational', true, true, true);
    const unbound = await prepareClassroom('Deep-unbound', false, true);
    const unreviewed = await prepareClassroom('Deep-unreviewed', true, true);
    const deleted = await prepareClassroom('Deep-deleted', true, true);
    const differentOwner = await prepareClassroom('Deep-other-owner', true, true);
    await submitQuiz(vocational);
    await submitQuiz(unbound);
    await submitQuiz(unreviewed, false);
    await submitQuiz(deleted);
    const staleAttempt = await submitQuiz(differentOwner);
    await saveDiscussionAndQA(vocational.stageId);
    await app.pool.query('UPDATE stage_meta SET deleted_at=now() WHERE stage_id=$1', [
      deleted.stageId,
    ]);
    await app.pool.query('UPDATE quiz_trace_attempts SET owner_id=$2 WHERE id=$1', [
      staleAttempt.attemptId,
      'anon:' + foreign,
    ]);

    await discoverProfileMemory(app);
    expect(
      await processProfileMemory(app, async () => {
        throw new Error('Excluded source entered the queue');
      }),
    ).toBe(false);
    const eligible = await prepareClassroom('Deep-empty-result', true, true);
    await submitQuiz(eligible);
    await discoverProfileMemory(app);
    expect((await readProfileMemory(owner, eligible.profile!)).maintenance.pending).toBe(true);
    let calls = 0;
    expect(
      await processProfileMemory(app, async () => {
        calls++;
        return '{"records":[]}';
      }),
    ).toBe(true);
    expect(calls).toBe(1);
    expect(await readProfileMemory(owner, eligible.profile!)).toMatchObject({
      items: [],
      maintenance: { pending: false, failed: false },
    });
    await discoverProfileMemory(app);
    expect(await processProfileMemory(app, async () => '{"records":[]}')).toBe(false);
  });

  it('keeps existing ordinary practice adoption and limits deep-interaction to standard Quiz', async () => {
    const direction = 'Practice the same idea with a different example.';
    const model = async () =>
      ({ serverManaged: true }) as Awaited<
        ReturnType<NonNullable<ConstructorParameters<typeof QuizPracticeService>[1]>['model']>
      >;
    const feedback = new QuizFeedbackService(app, {
      model,
      scope: async () => ({ runId: 'run', student: 'B', title: 'Synthetic' }),
      select: async () => undefined,
      verify: async () => true,
      generate: async () =>
        JSON.stringify({ summary: 'You chose B.', practiceDirection: direction }),
    });

    for (const [stageId, interactive] of [
      ['Ordinary-practice', false],
      ['Deep-practice', true],
    ] as const) {
      const course = await prepareClassroom(stageId, true, interactive);
      const { attemptId } = await submitQuiz(course);
      const quiz = await readQuizAttempt(app, owner, attemptId);
      const options = {
        owner,
        locator: {
          attemptId,
          versionId: quiz.version.id,
          submissionId: quiz.submission!.id,
          reviewId: quiz.review!.id,
        },
        environment: randomUUID(),
        language: 'en-US',
      };
      const practice = new QuizPracticeService(
        app,
        {
          model,
          generate: async () =>
            JSON.stringify({
              question: `${stageId} synthetic question`,
              options: ['One', 'Two', 'Three'],
              correctIndex: 1,
              analysis: 'The correct value is Two.',
            }),
        },
        feedback,
      );
      await feedback.generate(options);
      expect(await practice.accept(options)).toMatchObject({ status: 'ready' });
      expect(await practice.submit(options, 'B')).toMatchObject({
        submitted: true,
        review: { summary: { usableEarned: 1 } },
      });
    }

    await discoverProfileMemory(app);
    const questions: string[] = [];
    const extract: Parameters<typeof processProfileMemory>[1] = async (_owner, _system, input) => {
      questions.push(JSON.parse(input).parts[0].question);
      return '{"records":[]}';
    };
    while (await processProfileMemory(app, extract)) {
      // Collect all sources accepted by the real worker.
    }
    expect(questions.sort()).toEqual([
      'Ordinary-practice synthetic question',
      'Synthetic question V1',
      'Synthetic question V1',
    ]);
  });
});
