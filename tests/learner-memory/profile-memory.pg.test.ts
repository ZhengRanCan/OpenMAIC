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
import { readProfileMemorySource } from '@/lib/persistence/learner-profile-memory-source';
import { QuizTraceService } from '@/lib/persistence/quiz-trace';
import { readQuizAttempt } from '@/lib/persistence/quiz-trace-read';
import { getOwnerScopedDocumentStore } from '@/lib/server/agent-runtime/owner-scoped-documents';
import { resolveDialogueLearnerContext } from '@/lib/server/dialogue-learner-context';
import {
  generationRunPersistence,
  resetGenerationRunSchemaForTests,
} from '@/lib/server/generation/run/store';
import {
  assertInteractiveProfileMemoryCurrent,
  buildInteractiveProfileMemory,
} from '@/lib/server/generation/run/interactive-profile-memory';
import { editProfileMemory, readProfileMemory } from '@/lib/server/learner-profile-memory';
import { readProfilePlannerMastery } from '@/lib/server/learner-profile-mastery';
import {
  discoverProfileMastery,
  processProfileMastery,
} from '@/lib/server/learner-profile-mastery-runner';
import {
  checkProfileActivityHistory,
  resolveProfileSceneScope,
  selectProfileActivityHistory,
} from '@/lib/server/learner-profile-mastery-context';
import { GET as GET_MASTERY } from '@/app/api/learner-mastery/[stageId]/route';
import { QuizFeedbackService } from '@/lib/server/quiz-feedback';
import { QuizPracticeService } from '@/lib/server/quiz-practice';
import type { ResolvedModel } from '@/lib/server/resolve-model';
import {
  discoverProfileMemory,
  processProfileMemory,
} from '@/lib/server/learner-profile-memory-runner';
import type { ChatSession } from '@/lib/types/chat';
import { clearRuntimeChatSessions, saveChatSessions } from '@/lib/utils/chat-storage';
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
    ).toEqual([
      { kind: 'discussion' },
      { kind: 'discussion' },
      { kind: 'qa' },
      { kind: 'qa' },
      { kind: 'qa' },
      { kind: 'qa' },
      { kind: 'quiz' },
    ]);

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
    for (let i = 0; i < 7; i++) expect(await processProfileMemory(app, invoke)).toBe(true);
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
    expect(
      (await readProfileMemory(owner, deep.profile!)).items.map(({ kind }) => kind).sort(),
    ).toEqual(['discussion', 'qa']);
    expect(
      await buildInteractiveProfileMemory(
        owner,
        { profileId: deep.profile!, task: '密度', content: {} },
        async () => '{"selected":[]}',
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

  it('reads a formal Mastery card and history only for the bound profile and current saved evidence', async () => {
    const deep = await prepareClassroom('F98-Mastery', true, true);
    const other = await prepareClassroom('F98-Other-profile', true);
    const { attemptId } = await submitQuiz(deep);
    const quiz = await readQuizAttempt(app, owner, attemptId);
    const target = { id: 'F98-target', revision: 1, statement: '识别示例中的正确做法。' };
    const courseObjective = '能选择正确例子。';
    const evidenceRef = 'f98-observation';
    const assistance = 'unknown';
    const summary = '此次选项 B 正常评阅为答错，帮助条件未知。';
    await app.withTransaction(async (tx) => {
      const {
        rows: [binding],
      } = await tx.query<{ run_id: string }>(
        'SELECT run_id FROM classroom_learner_profiles WHERE stage_id=$1',
        [deep.stageId],
      );
      await tx.query(
        `INSERT INTO generation_runs(id,owner_id,input,state,stage_id,outline)
           VALUES($1,$2,$3,'completed',$4,$5)`,
        [
          binding.run_id,
          owner,
          { interactive: true },
          deep.stageId,
          {
            courseObjective,
            targets: [target],
            taskEngineMode: false,
          },
        ],
      );
      const data = await readProfileMemorySource(
        tx,
        {
          stage_id: deep.stageId,
          profile_id: deep.profile!,
          kind: 'quiz',
          activity_id: quiz.attemptId,
          record_id: quiz.submission!.id,
          review_id: quiz.review!.id,
        },
        { owner_id: owner, title: deep.stageId },
      );
      expect(data?.basis.parts[0]).toMatchObject({ review: 'incorrect', help: 'unknown' });
      await tx.query(
        `INSERT INTO learner_profile_mastery(stage_id,target_id,target_revision,state,sources)
           VALUES($1,$2,$3,$4,$5::jsonb)`,
        [
          deep.stageId,
          target.id,
          1,
          {
            targetStatement: target.statement,
            summary,
            unverified: ['待独立验证。'],
            observations: [
              { evidenceRef, coverage: 'direct', result: 'incorrect', assistance, text: summary },
            ],
          },
          JSON.stringify([
            {
              evidenceRef,
              kind: 'quiz',
              activityId: quiz.attemptId,
              recordId: quiz.submission!.id,
              reviewId: quiz.review!.id,
              digest: data!.digest,
              parts: [0],
              conditions: ['帮助情况未确认。'],
            },
          ]),
        ],
      );
    });

    const card = (identity = cookie) =>
      GET_MASTERY(
        new NextRequest(`http://localhost/api/learner-mastery/${deep.stageId}`, {
          headers: { cookie: 'anonymous_id=' + identity },
        }),
        { params: Promise.resolve({ stageId: deep.stageId }) },
      );
    const response = await card();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      courseObjective,
      cards: [
        {
          target,
          status: 'ready',
          summary,
          observations: [
            {
              assistance,
              source: {
                kind: 'quiz',
                questions: [{ prompt: 'Synthetic question V1', submitted: 'B' }],
              },
            },
          ],
        },
      ],
    });
    expect((await card(foreign)).status).toBe(404);
    const history = await readProfilePlannerMastery(owner, deep.profile!);
    expect(history).toMatchObject([
      { target, summary, observations: [{ assistance, conditions: ['帮助情况未确认。'] }] },
    ]);
    expect(JSON.stringify(history)).not.toContain('Synthetic question V1');
    await expect(readProfilePlannerMastery(owner, other.profile!)).resolves.toEqual([]);
    await expect(readProfilePlannerMastery('anon:' + foreign, deep.profile!)).rejects.toMatchObject(
      { code: 'unavailable' },
    );

    await reviewQuiz(attemptId, quiz.submission!.id, true);
    await expect(readProfilePlannerMastery(owner, deep.profile!)).resolves.toEqual([]);
    expect(await (await card()).json()).toMatchObject({
      cards: [{ target, status: 'unavailable' }],
    });
  });

  it('maintains only relevant formal Mastery and replaces a regraded source without duplicating the answer', async () => {
    const deep = await prepareClassroom('F99-deep-quiz', true, true);
    const other = await prepareClassroom('F99-other', true);
    const noProfile = await prepareClassroom('F99-no-profile', false, true);
    const target = { id: 'F99-quiz-target', revision: 1, statement: '识别本题中的正确做法。' };
    const unrelated = { id: 'F99-unrelated-target', revision: 1, statement: '用英语拼读 went。' };
    await app.withTransaction(async (tx) => {
      const {
        rows: [binding],
      } = await tx.query<{ run_id: string }>(
        'SELECT run_id FROM classroom_learner_profiles WHERE stage_id=$1',
        [deep.stageId],
      );
      await tx.query(
        `INSERT INTO generation_runs(id,owner_id,input,state,stage_id,outline)
        VALUES($1,$2,$3,'completed',$4,$5)`,
        [
          binding.run_id,
          owner,
          { interactive: true },
          deep.stageId,
          { targets: [target, unrelated] },
        ],
      );
    });
    const { attemptId } = await submitQuiz(deep);
    const saved = await readQuizAttempt(app, owner, attemptId);
    const options = (attempt: typeof saved, principal = owner) => ({
      owner: principal,
      environment: '',
      language: 'zh-CN',
      locator: {
        attemptId: attempt.attemptId,
        versionId: attempt.version.id,
        submissionId: attempt.submission!.id,
        reviewId: attempt.review!.id,
      },
    });
    let feedbackCalls = 0;
    const feedback = new QuizFeedbackService(app, {
      scope: async () => null,
      select: async () => undefined,
      verify: async () => false,
      formalScope: resolveProfileSceneScope,
      formalSelect: async () => undefined,
      formalVerify: async () => true,
      model: async () => ({ serverManaged: true }) as ResolvedModel,
      generate: async (_model, prompt) => {
        feedbackCalls++;
        expect(JSON.parse(prompt)).toMatchObject({
          quiz: { help: 'unknown', items: [{ correct: false }] },
        });
        expect(JSON.parse(prompt)).not.toHaveProperty('history');
        return JSON.stringify({ summary: '可再比较这两个选项。', practiceDirection: null });
      },
    });
    expect(await feedback.generate(options(saved))).toMatchObject({ status: 'ready' });
    expect(await feedback.generate(options(saved))).toMatchObject({ status: 'ready' });
    await expect(feedback.read(options(saved, 'anon:' + foreign))).rejects.toMatchObject({
      status: 404,
    });
    expect(feedbackCalls).toBe(1);
    const trace = new QuizTraceService(app);
    const unreviewed = await trace.prepare(owner, {
      operationId: randomUUID(),
      mode: 'retry',
      previousAttemptId: attemptId,
      stageId: deep.stageId,
      sceneId: deep.scene.id,
    });
    await trace.submit(owner, unreviewed.attemptId, {
      operationId: randomUUID(),
      submissionId: randomUUID(),
      answers: { q: 'B' },
    });
    const control = await submitQuiz(noProfile);
    expect(
      await feedback.generate(options(await readQuizAttempt(app, owner, control.attemptId))),
    ).toEqual({ status: 'disabled' });
    await expect(feedback.read(options(saved))).rejects.toMatchObject({ status: 409 });
    const invoke: Parameters<typeof processProfileMastery>[1] = async (principal, system, user) => {
      expect(principal).toBe(owner);
      expect(system).toContain('assistance 必须是 unknown');
      const task = JSON.parse(user);
      expect(task.evidence).toHaveLength(1);
      const item = task.evidence[0];
      if (item.type === 'learning_performance') {
        return JSON.stringify({
          assessments: [
            {
              evidenceRef: item.evidenceRef,
              coverage: 'context',
              result: 'ungraded',
              assistance: 'unknown',
              observation: '仅有个人偏好。',
            },
          ],
          candidateState: null,
          proof: [],
        });
      }
      expect(item.conditions).toContain('帮助情况未确认。');
      expect(item.questions[0]).toMatchObject({ prompt: 'Synthetic question V1', submitted: 'B' });
      const relevant = task.target === target.statement;
      const result = item.text.includes('为正确') ? 'correct' : 'incorrect';
      return JSON.stringify({
        assessments: [
          {
            evidenceRef: item.evidenceRef,
            coverage: relevant ? 'direct' : 'unrelated',
            result: relevant ? result : 'ungraded',
            assistance: 'unknown',
            observation: '读取这道选择题的有效评阅。',
          },
        ],
        candidateState: relevant
          ? {
              summary: '需继续核对独立能力。',
              unverified: ['独立判断仍待验证。'],
              adoptedEvidenceRefs: [item.evidenceRef],
            }
          : null,
      });
    };
    const first = async () => {
      for (let i = 0; i < 8 && (await processProfileMastery(app, invoke)); i++) {
        // The same fixture schema includes a previously saved F98 classroom.
      }
      expect(await processProfileMastery(app, invoke)).toBe(false);
    };
    await discoverProfileMastery(app);
    await first();
    const initialJobs = await app.pool.query(
      'SELECT kind,state FROM learner_profile_mastery_jobs WHERE stage_id=$1',
      [deep.stageId],
    );
    expect(initialJobs.rows).toEqual(
      Array.from({ length: 2 }, () => ({ kind: 'quiz', state: 'finished' })),
    );
    await discoverProfileMastery(app);
    expect(await processProfileMastery(app, invoke)).toBe(false);
    const firstHistory = await readProfilePlannerMastery(owner, deep.profile!);
    expect(firstHistory).toMatchObject([
      {
        target,
        observations: [{ result: 'incorrect', assistance: 'unknown' }],
      },
    ]);
    expect(await readProfilePlannerMastery(owner, other.profile!)).toEqual([]);
    await app.withTransaction(async (tx) => {
      await tx.query(
        `UPDATE learner_profile_mastery SET
        state=jsonb_set(state,'{observations,0,evidenceRef}',to_jsonb('legacy-quiz-ref'::text)),
        sources=jsonb_set(sources,'{0,evidenceRef}',to_jsonb('legacy-quiz-ref'::text))
        WHERE stage_id=$1 AND target_id=$2`,
        [deep.stageId, target.id],
      );
      await tx.query(
        'DELETE FROM learner_profile_mastery_jobs WHERE stage_id=$1 AND target_id=$2',
        [deep.stageId, target.id],
      );
    });
    await discoverProfileMastery(app);
    await first();
    expect((await readProfilePlannerMastery(owner, deep.profile!))[0].observations).toHaveLength(1);
    await saveDiscussionAndQA(deep.stageId);
    await app.withTransaction(async (tx) => {
      const source = await readProfileMemorySource(
        tx,
        {
          stage_id: deep.stageId,
          profile_id: deep.profile!,
          kind: 'discussion',
          activity_id: 'discussion',
          record_id: 'learner-answer',
        },
        { owner_id: owner, title: deep.stageId },
      );
      expect(source?.basis.parts[0].help).toBe('prior-teacher-messages');
      const evidenceRef = 'already-verified-discussion-basis';
      await tx.query(
        `UPDATE learner_profile_mastery SET state=jsonb_set(state,'{observations}',state->'observations' || $2::jsonb),
        sources=sources || $3::jsonb WHERE stage_id=$1`,
        [
          deep.stageId,
          JSON.stringify([
            {
              evidenceRef,
              coverage: 'partial',
              result: 'correct',
              assistance: 'assisted',
              text: '看过教师提示后完成列式。',
            },
          ]),
          JSON.stringify([
            {
              evidenceRef,
              kind: 'discussion',
              activityId: 'discussion',
              recordId: 'learner-answer',
              reviewId: null,
              digest: source!.digest,
              parts: [0],
              conditions: ['教师先提示了公式。'],
            },
          ]),
        ],
      );
    });
    await reviewQuiz(attemptId, saved.submission!.id, true);
    expect(await readProfilePlannerMastery(owner, deep.profile!)).toEqual([]);
    await discoverProfileMastery(app);
    await first();
    const regraded = await readProfilePlannerMastery(owner, deep.profile!);
    expect(regraded).toMatchObject([
      {
        target,
        observations: [
          { result: 'correct', assistance: 'assisted' },
          { result: 'correct', assistance: 'unknown' },
        ],
      },
    ]);
    expect(regraded[0].sourceVersion).not.toBe(firstHistory[0].sourceVersion);
    const original = await readQuizAttempt(app, owner, attemptId);
    expect(original.reviews.map((review) => review.id)).toContain(saved.review!.id);

    const selected = await selectProfileActivityHistory(
      {
        owner,
        profileId: deep.profile!,
        system: '测试来源版本。',
        task: target.statement,
        resolvedModel: { serverManaged: true } as ResolvedModel,
        beforeSelect: async () => {},
        usageLabel: 'f99-fingerprint-fixture',
      },
      async () => '{"selected":["T1"]}',
    );
    expect(selected?.fingerprints).toHaveLength(1);
    const newerTargets = Array.from({ length: 13 }, (_, index) => ({
      id: `F99-extra-target-${index}`,
      revision: 1,
      statement: `对照目标 ${index}`,
    }));
    await app.withTransaction(async (tx) => {
      await tx.query(
        `UPDATE generation_runs SET outline=jsonb_set(outline,'{targets}',outline->'targets' || $2::jsonb)
        WHERE stage_id=$1`,
        [deep.stageId, JSON.stringify(newerTargets)],
      );
      for (const extra of newerTargets) {
        await tx.query(
          `INSERT INTO learner_profile_mastery(stage_id,target_id,target_revision,state,sources,updated_at)
          SELECT stage_id,$3,1,jsonb_set(state,'{targetStatement}',to_jsonb($4::text)),sources,now()+interval '1 second'
          FROM learner_profile_mastery WHERE stage_id=$1 AND target_id=$2`,
          [deep.stageId, target.id, extra.id, extra.statement],
        );
      }
    });
    expect(
      (await readProfilePlannerMastery(owner, deep.profile!)).map(({ target }) => target.id),
    ).not.toContain(target.id);
    expect(await checkProfileActivityHistory(owner, deep.profile!, selected!.fingerprints)).toBe(
      true,
    );
    await app.withTransaction(async (tx) => {
      await tx.query(
        'DELETE FROM learner_profile_mastery WHERE stage_id=$1 AND target_id=ANY($2)',
        [deep.stageId, newerTargets.map(({ id }) => id)],
      );
      await tx.query(
        "UPDATE generation_runs SET outline=jsonb_set(outline,'{targets}',$2) WHERE stage_id=$1",
        [deep.stageId, JSON.stringify([target, unrelated])],
      );
    });
  });

  it('F100 validates actual student dialogue, preserves assistance, and removes deleted sources from planning', async () => {
    const classroom = await prepareClassroom('F100-deep', true, true);
    const target = {
      id: 'f100-density-target',
      revision: 1,
      statement: '用质量与体积列式计算密度。',
    };
    const other = { id: 'f100-other-target', revision: 1, statement: '识别英语过去式。' };
    const topic = '密度目标独立作答';
    const ask = '请独立列式并说明理由，提交前没有提示。';
    const hint = '这里先把质量换算成 60 克。';
    const answer = '我将 60 除以 30，算得密度是 2 克每立方厘米。';
    const unknown = '质量为 10 克，体积为 5 立方厘米，我列式 10 除以 5。';
    const onlyHelp = '这道题应该怎么做，请给我提示。';
    const helpWithGiven = '这道题应该怎么做，请给我提示，题目说质量是 60 克。';
    const helpAfterGiven = '已知质量=60克，能提示吗？';
    const assistedProofIsInvitation = '我先计算两数相除并写出新的结果。';
    const assistedProofIsGiven = '我用质量和体积相除，然后写出结果。';
    const givenOnly = '已知质量=60克，体积=30立方厘米，请独立列式。';
    const independentAfterCue = '我用 24 除以 6 得出 4。';
    const hiddenCue = '独立试试，记得质量与体积的比值。';
    const actions = [{ id: 'discussion', type: 'discussion' as const, topic, prompt: ask }];
    const store = await getOwnerScopedDocumentStore(owner);
    await store.putScene(classroom.stageId, { ...classroom.scene, actions });
    await app.pool.query(
      `INSERT INTO generation_runs(id,owner_id,input,state,stage_id,outline)
      SELECT run_id,$2,$3,'completed',stage_id,$4 FROM classroom_learner_profiles WHERE stage_id=$1`,
      [classroom.stageId, owner, { interactive: true }, { targets: [target, other] }],
    );
    const now = Date.now();
    const chatOptions = {
      store: app.runtimeStore,
      learnerKey: owner,
      legacyStore: { load: async () => [], clear: async () => undefined },
    };
    const session = (
      id: string,
      type: 'qa' | 'discussion',
      messages: ChatSession['messages'],
    ): ChatSession => ({
      id,
      title: type === 'discussion' ? topic : '密度 QA',
      type,
      status: 'completed',
      messages,
      config: { agentIds: ['teacher'] },
      toolCalls: [],
      pendingToolCalls: [],
      createdAt: now,
      updatedAt: now,
      initialContext: {
        stageId: classroom.stageId,
        stageTitle: classroom.stageId,
        sceneId: classroom.scene.id,
        sceneTitle: classroom.scene.title,
      },
    });
    const assistant = (id: string, text: string): ChatSession['messages'][number] => ({
      id,
      role: 'assistant',
      parts: [{ type: 'text', text }],
    });
    const student = (id: string, text: string): ChatSession['messages'][number] => ({
      id,
      role: 'user',
      parts: [{ type: 'text', text }],
    });
    await saveChatSessions(
      classroom.stageId,
      [
        session('f100-independent', 'discussion', [
          assistant('ask', ask),
          student('independent', answer),
        ]),
        session('f100-assisted', 'discussion', [
          assistant('hint', hint),
          student('assisted', answer),
        ]),
        session('f100-unknown', 'qa', [student('unknown', unknown)]),
        session('f100-false-assistance', 'discussion', [
          assistant('task-again', ask),
          student('false-assisted', assistedProofIsInvitation),
        ]),
        session('f100-false-given-assistance', 'discussion', [
          assistant('give-task', givenOnly),
          student('false-given-assisted', assistedProofIsGiven),
        ]),
        session('f100-false-independent', 'discussion', [
          assistant('independent-with-help', hiddenCue),
          student('false-independent', independentAfterCue),
        ]),
        session('f100-false-help-answer', 'qa', [student('help-with-given', helpWithGiven)]),
        session('f100-false-help-after-given', 'qa', [student('help-after-given', helpAfterGiven)]),
        session('f100-no-evidence', 'qa', [
          assistant('answer-key', answer),
          student('help', onlyHelp),
          { ...student('spoof-student', answer), metadata: { originalRole: 'agent' } },
        ]),
      ],
      chatOptions,
    );
    const invoke: Parameters<typeof processProfileMastery>[1] = async (
      principal,
      system,
      input,
    ) => {
      expect(principal).toBe(owner);
      expect(system).toContain('学生实际');
      const request = JSON.parse(input);
      const item = request.evidence[0];
      const text = item.messages.at(-1).text;
      const prior = item.messages.length > 1 ? item.messages[0].text : '';
      const independent =
        (prior === ask && text !== assistedProofIsInvitation) || prior === hiddenCue;
      const adopted = request.target === target.statement && text !== onlyHelp;
      const assistance = independent
        ? 'independent'
        : prior === hint || text === assistedProofIsInvitation || text === assistedProofIsGiven
          ? 'assisted'
          : 'unknown';
      return JSON.stringify({
        assessments: [
          {
            evidenceRef: item.evidenceRef,
            coverage: adopted ? 'direct' : 'context',
            result: adopted ? 'correct' : 'ungraded',
            assistance: adopted ? assistance : 'unknown',
            observation: adopted ? '提交了与目标相关的计算过程。' : '没有适用于当前目标的作答。',
          },
        ],
        candidateState: adopted
          ? {
              summary: '已有一份可回查的学生列式。',
              unverified: independent ? [] : ['继续核对换算。'],
              adoptedEvidenceRefs: [item.evidenceRef],
            }
          : null,
        proof: adopted
          ? [
              {
                evidenceRef: item.evidenceRef,
                studentQuote:
                  text === helpWithGiven
                    ? '质量是 60 克'
                    : text === helpAfterGiven
                      ? '质量=60克'
                      : text,
                teacherHelp:
                  text === assistedProofIsGiven
                    ? '已知质量=60克'
                    : assistance === 'assisted'
                      ? prior
                      : null,
              },
            ]
          : [],
      });
    };
    await Promise.all([discoverProfileMastery(app), discoverProfileMastery(app)]);
    for (let attempt = 0; attempt < 22 && (await processProfileMastery(app, invoke)); attempt++) {
      // Drain the eligible saved records without relying on the interval timer.
    }
    await discoverProfileMastery(app);
    expect(await processProfileMastery(app, invoke)).toBe(false);
    const rejected = await app.pool.query(
      `SELECT record_id,state FROM learner_profile_mastery_jobs
      WHERE stage_id=$1 AND target_id=$2 AND record_id=ANY($3)`,
      [
        classroom.stageId,
        target.id,
        [
          'false-assisted',
          'false-given-assisted',
          'false-independent',
          'help-with-given',
          'help-after-given',
        ],
      ],
    );
    expect(rejected.rows).toHaveLength(5);
    expect(rejected.rows.every(({ state }) => state === 'queued')).toBe(true);
    const history = await readProfilePlannerMastery(owner, classroom.profile!);
    expect(history).toHaveLength(1);
    expect(history[0].observations.map(({ assistance }) => assistance).sort()).toEqual([
      'assisted',
      'independent',
      'unknown',
    ]);
    const raw = await GET_MASTERY(
      new NextRequest(`http://localhost/api/learner-mastery/${classroom.stageId}`, {
        headers: { cookie: 'anonymous_id=' + cookie },
      }),
      { params: Promise.resolve({ stageId: classroom.stageId }) },
    );
    expect(raw.status).toBe(200);
    const { cards } = await raw.json();
    expect(
      cards[0].observations.find(
        ({ assistance }: { assistance: string }) => assistance === 'assisted',
      ).source.messages,
    ).toEqual([
      { role: 'agent', text: hint },
      { role: 'student', text: answer },
    ]);
    expect(cards[1]).toMatchObject({ status: 'empty' });
    await clearRuntimeChatSessions(classroom.stageId, chatOptions);
    expect(await readProfilePlannerMastery(owner, classroom.profile!)).toEqual([]);
  });

  it('F100 maintains long ordinary QA and preserves the original source when the view reaches 200 messages', async () => {
    const classroom = await prepareClassroom('F100-long-ordinary', true);
    const answer = '以后复习物理时，请先列出易错点。';
    const preceding = Array.from({ length: 8 }, (_, index): ChatSession['messages'][number] => ({
      id: `long-before-${index}`,
      role: 'assistant',
      parts: [{ type: 'text', text: `资料 ${index} ` + 'a'.repeat(4000) }],
    }));
    const now = Date.now();
    const chat: ChatSession = {
      id: 'f100-long-qa',
      type: 'qa',
      title: '物理偏好',
      status: 'active',
      config: { agentIds: ['teacher'] },
      toolCalls: [],
      pendingToolCalls: [],
      createdAt: now,
      updatedAt: now,
      initialContext: {
        stageId: classroom.stageId,
        stageTitle: classroom.stageId,
        sceneId: classroom.scene.id,
        sceneTitle: classroom.scene.title,
      },
      messages: [
        ...preceding,
        { id: 'f100-long-preference', role: 'user', parts: [{ type: 'text', text: answer }] },
      ],
    };
    const options = {
      store: app.runtimeStore,
      learnerKey: owner,
      legacyStore: { load: async () => [], clear: async () => undefined },
    };
    await saveChatSessions(classroom.stageId, [chat], options);
    await discoverProfileMemory(app);
    const invoke: Parameters<typeof processProfileMemory>[1] = async (_owner, _system, payload) => {
      const { parts } = JSON.parse(payload);
      if (parts[0].answer !== answer) return '{"records":[]}';
      expect(parts[0].previous).toHaveLength(2);
      return JSON.stringify({ records: [{ section: 'preferences', summary: answer, refs: [0] }] });
    };
    for (let step = 0; step < 30 && (await processProfileMemory(app, invoke)); step++) {
      // Drain previously discovered fixture jobs independently of their order.
    }
    const view = await readProfileMemory(owner, classroom.profile!);
    expect(view.items).toHaveLength(1);
    const readBasis = async () =>
      await (
        await GET_BASIS(
          new NextRequest(
            'http://localhost/api/learner-profiles/' +
              classroom.profile +
              '/memory/' +
              view.items[0].id,
            { headers: { cookie: 'anonymous_id=' + cookie } },
          ),
          { params: Promise.resolve({ profileId: classroom.profile!, itemId: view.items[0].id }) },
        )
      ).json();
    const basis = await readBasis();
    expect(basis.parts[0].previous).toHaveLength(8);
    const after = Array.from({ length: 191 }, (_, index): ChatSession['messages'][number] => ({
      id: `long-after-${index}`,
      role: 'assistant',
      parts: [{ type: 'text', text: '已保存的后续教学发言。' }],
    }));
    await saveChatSessions(
      classroom.stageId,
      [{ ...chat, messages: [...chat.messages, ...after], updatedAt: now + 1000 }],
      options,
    );
    expect(await readBasis()).toEqual(basis);
    await app.pool.query(
      `INSERT INTO generation_runs(id,owner_id,input,state,stage_id,outline)
      SELECT run_id,$2,'{}'::jsonb,'completed',stage_id,'{"targets":[]}'::jsonb FROM classroom_learner_profiles WHERE stage_id=$1`,
      [classroom.stageId, owner],
    );
    const enabled = process.env.OPENMAIC_DIALOGUE_LEARNER_CONTEXT;
    process.env.OPENMAIC_DIALOGUE_LEARNER_CONTEXT = 'true';
    try {
      const result = await resolveDialogueLearnerContext(
        {
          owner,
          signal: new AbortController().signal,
          model: { serverManaged: true } as ResolvedModel,
          body: {
            config: { agentIds: ['teacher'], sessionType: 'qa' },
            messages: [
              {
                id: 'current-question',
                role: 'user',
                parts: [{ type: 'text', text: '可以怎么复习物理？' }],
              },
            ],
            storeState: {
              stage: {
                id: classroom.stageId,
                name: classroom.stageId,
                createdAt: now,
                updatedAt: now,
              },
              scenes: [classroom.scene],
              currentSceneId: classroom.scene.id,
              mode: 'autonomous',
              whiteboardOpen: false,
            },
          },
        },
        {
          selectFormal: async (request) => {
            const selected = await selectProfileActivityHistory(request, async ({ prompt }) => {
              const candidate = JSON.parse(prompt.user).candidates.find(
                (item: { value: { text?: string } }) => item.value.text === answer,
              );
              expect(candidate).toBeTruthy();
              return JSON.stringify({ selected: [candidate.id] });
            });
            expect(selected?.text).toContain(answer);
            await clearRuntimeChatSessions(classroom.stageId, options);
            return selected;
          },
        },
      );
      expect(result).toEqual({ status: 'empty' });
    } finally {
      if (enabled === undefined) delete process.env.OPENMAIC_DIALOGUE_LEARNER_CONTEXT;
      else process.env.OPENMAIC_DIALOGUE_LEARNER_CONTEXT = enabled;
    }
  });

  it('provisions the formal Mastery schema when an existing classroom is opened after a v8 upgrade', async () => {
    const classroom = await prepareClassroom('F98-upgrade', true, true);
    const target = { id: 'F98-upgrade-target', revision: 1, statement: '说明密度的含义。' };
    await app.withTransaction(async (tx) => {
      await tx.query(
        `INSERT INTO generation_runs(id,owner_id,input,state,stage_id,outline)
         SELECT run_id,$2,$3,'completed',stage_id,$4 FROM classroom_learner_profiles
          WHERE stage_id=$1`,
        [classroom.stageId, owner, { interactive: true }, { targets: [target] }],
      );
      await tx.query('DROP TABLE learner_profile_mastery_jobs');
      await tx.query('DROP TABLE learner_profile_mastery');
      await tx.query('DROP INDEX classroom_learner_profiles_profile_idx');
      await tx.query(
        "DELETE FROM openmaic_schema_migrations WHERE store='generation-runs' AND version>8",
      );
    });
    resetGenerationRunSchemaForTests();

    const response = await GET_MASTERY(
      new NextRequest(`http://localhost/api/learner-mastery/${classroom.stageId}`, {
        headers: { cookie: 'anonymous_id=' + cookie },
      }),
      { params: Promise.resolve({ stageId: classroom.stageId }) },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ cards: [{ target, status: 'empty' }] });
  });
});
