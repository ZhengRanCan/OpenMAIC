import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { ensureAssetSchema, PgAssetStore } from '@openmaic/storage/asset/pg';
import { PgAssetByteStore } from '@openmaic/storage/asset/pg-bytes';
import type { Queryable, WithTransaction } from '@openmaic/storage/document/pg';
import type { ServerPersistenceProvider } from '@/lib/persistence/server-provider';
import { readDialogueEvidenceRun } from '@/lib/persistence/dialogue-evidence-read';
import { QuizTraceService } from '@/lib/persistence/quiz-trace';
import { ensureQuizTraceSchema } from '@/lib/persistence/quiz-trace-schema';
import { discoverClosedDialogues } from '@/lib/server/dialogue-learning-loop/discovery';
import { enqueueClosedDialogueIn } from '@/lib/server/dialogue-learning-loop/enqueue';
import {
  processDialogueJob,
  type DialogueLoopDeps,
} from '@/lib/server/dialogue-learning-loop/process';
import { createLearningLoopAdapter } from '@/lib/server/quiz-learning-loop/adapter';
import { requestFromStoredAttribution } from '@/lib/server/quiz-learning-loop/attribution';
import {
  activateLearningLoop,
  discoverReviewedQuizzes,
} from '@/lib/server/quiz-learning-loop/discovery';
import { enqueueReviewedQuiz } from '@/lib/server/quiz-learning-loop/enqueue-reviewed';
import { processLearningLoop } from '@/lib/server/quiz-learning-loop/process';
import { retryMemory } from '@/lib/server/quiz-learning-loop/retry-memory';
import {
  claimLearningLoop,
  ensureLearningLoopSchema,
  type LearningLoopJob,
} from '@/lib/server/quiz-learning-loop/store';
import { ensureShortFactsSchema, QuizShortFactsService } from '@/lib/server/quiz-short-facts';
import { model, reply } from './dialogue-evidence-fixture';
import { dialogueLoopFixture } from './dialogue-learning-loop-fixture';
import { controlledMemoryReply, memoryModel } from './dialogue-memory-fixture';
import { testScene } from './quiz-trace-fixture';

const url = process.env.F76_CONTROL_PG_URL ?? process.env.PG_CONTRACT_URL;

async function createQuiz(f: Awaited<ReturnType<typeof dialogueLoopFixture>>) {
  await ensureAssetSchema(f.db);
  await f.db.query('CREATE TABLE document_scenes(stage_id TEXT,id TEXT,data JSONB)');
  await ensureQuizTraceSchema(f.db);
  await ensureLearningLoopSchema(f.db);
  await ensureShortFactsSchema(f.db);
  const assets = (tx: Queryable, body: WithTransaction) =>
    new PgAssetStore(tx, { withTransaction: body, byteStore: new PgAssetByteStore(f.db) });
  const trace = new QuizTraceService({
    ...f.provider,
    pool: f.db,
    runtimeStore: f.runtime,
    assetStore: assets(f.db, f.provider.withTransaction),
    assetStoreIn: (tx: Queryable) => assets(tx, (body) => body(tx)),
  } as ServerPersistenceProvider);
  const scene = { ...structuredClone(testScene), id: 'quiz-scene' };
  await f.db.query("INSERT INTO document_scenes VALUES('stage',$1,$2::jsonb)", [
    scene.id,
    JSON.stringify(scene),
  ]);
  await f.db.query(
    `INSERT INTO generation_run_steps(run_id,step_id,output)
     VALUES('run','scene:1:narration','{"scene":{"id":"quiz-scene"}}')`,
  );
  await activateLearningLoop(f.provider.withTransaction, f.config);
  const attempt = await trace.prepare('owner', {
    operationId: 'start',
    mode: 'start',
    stageId: 'stage',
    sceneId: scene.id,
    scene,
  });
  await trace.submit('owner', attempt.attemptId, {
    operationId: 'submit',
    submissionId: 'submission',
    answers: { q: 'A' },
  });
  const review = await trace.beginReview('owner', attempt.attemptId, {
    operationId: 'review',
    submissionId: 'submission',
    language: 'zh-CN',
  });
  await trace.finishReview('owner', review, {
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
  expect(await discoverReviewedQuizzes(f.provider.withTransaction, f.config)).toBe(1);
  return attempt.attemptId;
}

it.skipIf(!url).each(['quiz-first', 'dialogue-first', 'quiz-commit-failure'] as const)(
  'checks both production job processors with %s',
  async (scenario) => {
    const f = await dialogueLoopFixture(url!);
    let signalCalling!: () => void;
    let resumeCall!: () => void;
    const calling = new Promise<void>((resolve) => {
      signalCalling = resolve;
    });
    const paused = new Promise<void>((resolve) => {
      resumeCall = resolve;
    });
    const calls = { quiz: { evidence: 0, memory: 0 }, dialogue: { evidence: 0, memory: 0 } };
    const firstKind = scenario === 'quiz-first' ? 'quiz' : 'dialogue';
    const secondKind = firstKind === 'quiz' ? 'dialogue' : 'quiz';
    const failCommit = scenario === 'quiz-commit-failure';
    let first: Promise<void> | undefined;
    try {
      const attemptId = await createQuiz(f);
      const { job: dialogueJob } = await f.create();
      const baseline = await f.memory.read('A');
      expect(baseline.usable.revision).toBe(0);
      const otherLearner = await f.memory.read('B');
      const facts = new QuizShortFactsService(f.provider.withTransaction);
      const quizState = async () =>
        (await f.db.query<LearningLoopJob>('SELECT * FROM quiz_learning_loop_jobs')).rows[0];
      const dialogueState = () => f.jobs.read('owner', dialogueJob.id);
      const capture = async (
        kind: 'quiz' | 'dialogue',
        run: Parameters<typeof controlledMemoryReply>[0],
      ) => {
        calls[kind].memory++;
        if (kind === firstKind && calls[kind].memory === 1) {
          signalCalling();
          await paused;
        }
        return controlledMemoryReply(run);
      };
      const deps: DialogueLoopDeps = {
        jobs: f.jobs,
        evidence: f.store,
        memory: f.service,
        config: f.config,
        settings: async () => f.settings,
        readEvidence: (owner, id) => readDialogueEvidenceRun(f.provider, owner, id),
        evidenceModel: model,
        memoryModel,
        checkEvidence: () => {},
        checkMemory: () => {},
        invokeEvidence: async () => {
          calls.dialogue.evidence++;
          return reply;
        },
        invokeMemory: (run) => capture('dialogue', run),
      };
      const run = async (kind: 'quiz' | 'dialogue') => {
        if (kind === 'dialogue') {
          const claim = await f.jobs.claim();
          expect(claim?.id).toBe(dialogueJob.id);
          return processDialogueJob(claim!, deps);
        }
        const claim = await f.provider.withTransaction((tx) => claimLearningLoop(tx, randomUUID()));
        expect(claim?.attempt_id).toBe(attemptId);
        const adapter = createLearningLoopAdapter({
          service: facts,
          memory: f.memory,
          resolveRequest: requestFromStoredAttribution,
          extract: async () => {
            calls.quiz.evidence++;
            const { context } = await facts.read('owner', (await quizState()).evidence_run_id!);
            return {
              text: JSON.stringify({
                facts: [
                  {
                    type: 'correct_performance',
                    evidence: '选中正确选项A',
                    refs: [Object.keys(context.refs)[0]],
                  },
                ],
              }),
              finishReason: 'stop',
              model: 'synthetic-control',
              usage: null,
            };
          },
          updateMemory: (prepared) => capture('quiz', prepared),
        });
        await processLearningLoop(f.db, claim!, adapter);
      };
      first = run(firstKind);
      await Promise.race([
        calling,
        first.then(() => {
          throw Error('first job exited before Memory');
        }),
      ]);
      if (!failCommit) {
        await run(secondKind);
        expect(calls[secondKind]).toEqual({ evidence: 1, memory: 0 });
        expect((await f.memory.read('A')).usable.revision).toBe(0);
        if (secondKind === 'dialogue') {
          expect(await dialogueState()).toMatchObject({
            state: 'waiting',
            reason: 'MEMORY_PENDING_SOURCES',
          });
        } else {
          expect(await quizState()).toMatchObject({
            state: 'queued',
            error_code: 'MEMORY_PENDING_SOURCES',
            claim_id: null,
          });
          expect(
            await f.provider.withTransaction((tx) => claimLearningLoop(tx, randomUUID())),
          ).toBeNull();
          expect(
            (await f.memoryDb.query('SELECT count(*)::int AS n FROM learner_memory_runs')).rows,
          ).toEqual([{ n: 1 }]);
        }
      }
      resumeCall();
      await first;
      const afterFirst = await f.memory.read('A');
      expect(afterFirst.usable.revision).toBe(1);
      expect((firstKind === 'quiz' ? await quizState() : await dialogueState()).state).toBe(
        'completed',
      );

      if (failCommit) {
        await f.memoryDb.query(`
          CREATE FUNCTION fail_f76_commit() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN RAISE EXCEPTION 'injected F76 commit fault'; END; $$;
          CREATE TRIGGER fail_f76_commit BEFORE UPDATE ON learner_memory_runs
          FOR EACH ROW WHEN (NEW.state='completed') EXECUTE FUNCTION fail_f76_commit();
        `);
        await run('quiz');
        const quiz = await quizState();
        expect(quiz).toMatchObject({ state: 'unknown', error_code: 'PROCESS_RESULT_UNKNOWN' });
        expect(
          (
            await f.memoryDb.query('SELECT state FROM learner_memory_runs WHERE id=$1', [
              'f68:' + quiz.evidence_run_id,
            ])
          ).rows,
        ).toEqual([{ state: 'captured' }]);
        expect((await f.memory.read('A')).usable).toEqual(afterFirst.usable);
        expect((await dialogueState()).state).toBe('completed');
        await f.memoryDb.query('DROP TRIGGER fail_f76_commit ON learner_memory_runs');
      }

      const quizEvidence = (await quizState()).evidence_run_id;
      const dialogueEvidence = (await dialogueState()).evidenceRunId;
      expect(quizEvidence).toBeTruthy();
      expect(dialogueEvidence).toBeTruthy();
      expect((await facts.read('owner', quizEvidence!)).state).toBe('completed');
      expect((await readDialogueEvidenceRun(f.provider, 'owner', dialogueEvidence!)).state).toBe(
        'completed',
      );
      if (secondKind === 'dialogue') {
        await discoverClosedDialogues(f.provider, f.config);
      } else if (failCommit) {
        await discoverReviewedQuizzes(f.provider.withTransaction, f.config);
        expect(
          await f.provider.withTransaction((tx) => claimLearningLoop(tx, randomUUID())),
        ).toBeNull();
        expect(await retryMemory(f.db, facts, f.memory, 'owner', attemptId, false)).toBe('queued');
      } else {
        // Advance the queue timestamp past its retry delay without sleeping.
        await f.db.query(
          "UPDATE quiz_learning_loop_jobs SET updated_at=now()-interval '11 seconds' WHERE attempt_id=$1",
          [attemptId],
        );
      }
      await run(secondKind);
      expect(await quizState()).toMatchObject({
        state: 'completed',
        evidence_run_id: quizEvidence,
      });
      expect(await dialogueState()).toMatchObject({
        state: 'completed',
        evidenceRunId: dialogueEvidence,
      });
      expect(calls).toEqual({
        quiz: { evidence: 1, memory: 1 },
        dialogue: { evidence: 1, memory: 1 },
      });
      const after = await f.memory.read('A');
      expect(after.usable.revision).toBe(2);
      expect(
        after.sections.learning_experiences
          .flatMap((piece) => piece.supports.map((support) => support.kind))
          .sort(),
      ).toEqual(['dialogue_evidence', 'quiz_evidence']);
      expect(await f.memory.read('B')).toEqual(otherLearner);

      await enqueueReviewedQuiz(f.provider.withTransaction, 'owner', attemptId, f.config);
      const replay = await f.provider.withTransaction((tx) =>
        enqueueClosedDialogueIn(
          tx,
          'owner',
          { stageId: 'stage', chatSessionId: 'newchat' },
          f.config,
        ),
      );
      expect(replay?.id).toBe(dialogueJob.id);
      expect(await discoverReviewedQuizzes(f.provider.withTransaction, f.config)).toBe(0);
      await discoverClosedDialogues(f.provider, f.config);
      expect(await f.jobs.claim()).toBeNull();
      expect(
        await f.provider.withTransaction((tx) => claimLearningLoop(tx, randomUUID())),
      ).toBeNull();
      expect(await f.memory.read('A')).toEqual(after);
      console.info(
        JSON.stringify({
          scenario,
          revisions: [baseline.usable.revision, afterFirst.usable.revision, after.usable.revision],
          outcome:
            secondKind === 'dialogue'
              ? 'automatic_wait'
              : failCommit
                ? 'captured_reply_recovery'
                : 'automatic_requeue',
          evidenceIdsReused: true,
          calls,
        }),
      );
    } finally {
      resumeCall();
      await first?.catch(() => {});
      await f.close();
    }
  },
  20000,
);
