import { randomUUID } from 'node:crypto';
import { PgRuntimeStore } from '@openmaic/storage/runtime/pg';
import type { Queryable } from '@openmaic/storage/document/pg';
import type {
  PreparedQuiz,
  PrepareQuizInput,
  QuizDraftWrite,
  QuizSubmissionInput,
  QuizSubmission,
  QuizReviewInput,
  QuizReviewReservation,
  QuizReview,
  QuizEvaluation,
} from '@/lib/quiz/trace-types';
import {
  requireId,
  validateAnswers,
  decideSubmission,
  projectQuizScore,
  QuizTraceError,
} from '@/lib/quiz/trace-validation';
import { APP_RUNTIME_PAYLOAD_VALIDATORS } from '@/lib/runtime/payload-validators';
import { fenceOwnerWrite } from './owner-merges';
import { digestOf, ensureSceneVersionIn, readSceneVersionIn } from './scene-history';
import type { ServerPersistenceProvider } from './server-provider';

export interface AttemptRow extends Record<string, unknown> {
  id: string;
  owner_id: string;
  stage_id: string;
  scene_id: string;
  version_id: string;
  previous_id: string | null;
  submission: QuizSubmission | null;
  current_review_id: string | null;
}
export const runtimeIn = (tx: Queryable) =>
  new PgRuntimeStore(tx, {
    withTransaction: (body) => body(tx),
    payloadValidators: APP_RUNTIME_PAYLOAD_VALIDATORS,
  });
export async function readPreparedIn(
  tx: Queryable,
  owner: string,
  id: string,
): Promise<PreparedQuiz> {
  const r = await tx.query<AttemptRow>(
    'SELECT a.* FROM quiz_trace_attempts a JOIN stage_meta m ON m.stage_id=a.stage_id WHERE a.id=$1 AND a.owner_id=$2 AND m.deleted_at IS NULL',
    [id, owner],
  );
  const row = r.rows[0];
  if (!row) throw new QuizTraceError('ATTEMPT_NOT_FOUND', 404);
  const version = await readSceneVersionIn(tx, owner, row.version_id);
  const records = await runtimeIn(tx).listRecords(id);
  const tail = records.at(-1);
  if (!tail || tail.sceneId !== row.scene_id) throw new QuizTraceError('CORRUPT_ATTEMPT', 500);
  const reviews = await tx.query<
    { id: string; ordinal: number; result: QuizReview | null } & Record<string, unknown>
  >('SELECT id,ordinal,result FROM quiz_trace_reviews WHERE attempt_id=$1 ORDER BY ordinal', [id]);
  const current = reviews.rows.find((r) => r.id === row.current_review_id)?.result ?? undefined;
  const pending = reviews.rows.filter((r) => r.result === null).at(-1);
  const previousUsableReview =
    current?.summary.status === 'unavailable'
      ? reviews.rows
          .filter(
            (r) =>
              r.result && r.result.ordinal < current.ordinal && r.result.summary.usablePossible > 0,
          )
          .at(-1)?.result
      : undefined;
  return {
    attemptId: id,
    stageId: row.stage_id,
    sceneId: row.scene_id,
    version,
    answers:
      row.submission?.answers ?? (tail.payload as { answers: PreparedQuiz['answers'] }).answers,
    lastSeq: tail.seq,
    ...(row.submission ? { submission: row.submission } : {}),
    ...(current ? { review: current } : {}),
    reviews: reviews.rows.flatMap((r) => (r.result ? [r.result] : [])),
    ...(previousUsableReview ? { previousUsableReview } : {}),
    ...(pending ? { pendingReview: { id: pending.id, ordinal: pending.ordinal } } : {}),
  };
}
export class QuizTraceService {
  constructor(readonly provider: ServerPersistenceProvider) {}
  private async transaction<T>(owner: string, body: (tx: Queryable) => Promise<T>): Promise<T> {
    return this.provider.withTransaction(async (tx) => {
      await fenceOwnerWrite(tx, owner);
      return body(tx);
    });
  }
  private async stage(tx: Queryable, owner: string, stageId: string) {
    const r = await tx.query(
      'SELECT stage_id FROM stage_meta WHERE stage_id=$1 AND owner_id=$2 AND deleted_at IS NULL FOR UPDATE',
      [stageId, owner],
    );
    if (!r.rows.length) throw new QuizTraceError('STAGE_NOT_FOUND', 404);
  }
  private async op(tx: Queryable, owner: string, id: string, kind: string, input: unknown) {
    requireId(id);
    const r = await tx.query<
      { kind: string; digest: string; result: Record<string, unknown> } & Record<string, unknown>
    >('SELECT kind,digest,result FROM quiz_trace_operations WHERE owner_id=$1 AND id=$2', [
      owner,
      id,
    ]);
    if (!r.rows[0]) return undefined;
    if (r.rows[0].kind !== kind || r.rows[0].digest !== digestOf(input))
      throw new QuizTraceError('OPERATION_CONFLICT');
    return r.rows[0].result;
  }
  private async remember(
    tx: Queryable,
    owner: string,
    id: string,
    stage: string,
    kind: string,
    input: unknown,
    result: unknown,
  ) {
    await tx.query(
      'INSERT INTO quiz_trace_operations(owner_id,id,stage_id,kind,digest,result) VALUES($1,$2,$3,$4,$5,$6::jsonb)',
      [owner, id, stage, kind, digestOf(input), JSON.stringify(result)],
    );
  }
  private async locked(tx: Queryable, owner: string, id: string): Promise<AttemptRow> {
    requireId(id);
    const check = await tx.query<AttemptRow>(
      'SELECT * FROM quiz_trace_attempts WHERE id=$1 AND owner_id=$2',
      [id, owner],
    );
    if (!check.rows[0]) throw new QuizTraceError('ATTEMPT_NOT_FOUND', 404);
    await this.stage(tx, owner, check.rows[0].stage_id);
    const r = await tx.query<AttemptRow>(
      'SELECT * FROM quiz_trace_attempts WHERE id=$1 AND owner_id=$2 FOR UPDATE',
      [id, owner],
    );
    if (!r.rows[0]) throw new QuizTraceError('ATTEMPT_NOT_FOUND', 404);
    return r.rows[0];
  }
  async prepare(owner: string, input: PrepareQuizInput): Promise<PreparedQuiz> {
    requireId(input.stageId);
    requireId(input.sceneId);
    requireId(input.operationId);
    if (!['start', 'retry'].includes(input.mode)) throw new QuizTraceError('INVALID_MODE', 400);
    if (input.mode === 'start' && input.previousAttemptId !== undefined)
      throw new QuizTraceError('INVALID_PREVIOUS_ATTEMPT', 400);
    return this.transaction(owner, async (tx) => {
      await this.stage(tx, owner, input.stageId);
      const replay = await this.op(tx, owner, input.operationId, 'prepare', input);
      if (replay) return readPreparedIn(tx, owner, String(replay.attemptId));
      const latest = await tx.query<AttemptRow>(
        'SELECT * FROM quiz_trace_attempts WHERE owner_id=$1 AND stage_id=$2 AND scene_id=$3 ORDER BY created_at DESC,id DESC LIMIT 1',
        [owner, input.stageId, input.sceneId],
      );
      let version;
      if (input.mode === 'retry') {
        if (!input.previousAttemptId) throw new QuizTraceError('PREVIOUS_ATTEMPT_REQUIRED', 400);
        const prior = await this.locked(tx, owner, input.previousAttemptId);
        if (prior.stage_id !== input.stageId || prior.scene_id !== input.sceneId)
          throw new QuizTraceError('ATTEMPT_SCOPE_CONFLICT');
        const child = await tx.query<AttemptRow>(
          'SELECT * FROM quiz_trace_attempts WHERE previous_id=$1 AND owner_id=$2 AND stage_id=$3 AND scene_id=$4',
          [prior.id, owner, input.stageId, input.sceneId],
        );
        if (child.rows[0]) {
          const restored = await readPreparedIn(tx, owner, child.rows[0].id);
          if (
            latest.rows[0]?.id !== restored.attemptId ||
            restored.submission ||
            Object.keys(restored.answers).length
          )
            throw new QuizTraceError('RETRY_ALREADY_PROGRESSED');
          await this.remember(tx, owner, input.operationId, input.stageId, 'prepare', input, {
            attemptId: restored.attemptId,
          });
          return restored;
        }
        if (latest.rows[0]?.id !== prior.id || !prior.submission)
          throw new QuizTraceError('RETRY_NOT_AVAILABLE');
        version = await readSceneVersionIn(tx, owner, prior.version_id);
      } else {
        if (latest.rows[0]) {
          await this.remember(tx, owner, input.operationId, input.stageId, 'prepare', input, {
            attemptId: latest.rows[0].id,
          });
          return readPreparedIn(tx, owner, latest.rows[0].id);
        }
        const scene = input.scene;
        if (!scene || scene.id !== input.sceneId || scene.stageId !== input.stageId)
          throw new QuizTraceError('SCENE_REQUIRED', 400);
        const exists = await tx.query(
          'SELECT id FROM document_scenes WHERE stage_id=$1 AND id=$2',
          [input.stageId, input.sceneId],
        );
        if (!exists.rows.length) throw new QuizTraceError('SCENE_NOT_FOUND', 404);
        // No order-based target inference. Capture only an explicitly matching outline.
        let planning: Record<string, unknown> | undefined;
        if (scene.outlineId && input.planning?.id === scene.outlineId) planning = input.planning;
        else if (
          scene.outlineId &&
          input.planning?.outlineId === scene.outlineId &&
          (input.planning.outline as { id?: unknown })?.id === scene.outlineId
        )
          planning = input.planning;
        version = await ensureSceneVersionIn(tx, this.provider, owner, scene, planning);
      }
      const id = randomUUID(),
        now = new Date().toISOString(),
        store = runtimeIn(tx);
      await store.createSession({
        id,
        kind: 'quizAttempt',
        stageId: input.stageId,
        learnerKey: owner,
        status: 'active',
        createdAt: now,
        updatedAt: now,
      });
      await store.appendRecord({
        id: randomUUID(),
        sessionId: id,
        sceneId: input.sceneId,
        createdAt: now,
        payload: { payloadVersion: 2, phase: 'draft', answers: {}, versionId: version.id },
      });
      await tx.query(
        'INSERT INTO quiz_trace_attempts(id,owner_id,stage_id,scene_id,version_id,previous_id) VALUES($1,$2,$3,$4,$5,$6)',
        [id, owner, input.stageId, input.sceneId, version.id, input.previousAttemptId ?? null],
      );
      await this.remember(tx, owner, input.operationId, input.stageId, 'prepare', input, {
        attemptId: id,
      });
      return readPreparedIn(tx, owner, id);
    });
  }
  async saveDraft(owner: string, id: string, input: QuizDraftWrite): Promise<PreparedQuiz> {
    return this.transaction(owner, async (tx) => {
      const row = await this.locked(tx, owner, id);
      const replay = await this.op(tx, owner, input.operationId, 'draft', { id, ...input });
      if (replay) return readPreparedIn(tx, owner, id);
      if (row.submission) throw new QuizTraceError('ANSWERS_LOCKED');
      const prepared = await readPreparedIn(tx, owner, id);
      if (prepared.version.scene.type !== 'quiz') throw new QuizTraceError('INVALID_VERSION', 500);
      validateAnswers(input.answers, prepared.version.scene.content.questions);
      if (prepared.lastSeq !== input.expectedLastSeq) throw new QuizTraceError('DRAFT_CONFLICT');
      await runtimeIn(tx).appendRecord(
        {
          id: randomUUID(),
          sessionId: id,
          sceneId: row.scene_id,
          createdAt: new Date().toISOString(),
          payload: {
            payloadVersion: 2,
            phase: 'draft',
            answers: input.answers,
            versionId: row.version_id,
          },
        },
        { expectedLastSeq: input.expectedLastSeq },
      );
      await this.remember(
        tx,
        owner,
        input.operationId,
        row.stage_id,
        'draft',
        { id, ...input },
        { attemptId: id },
      );
      return readPreparedIn(tx, owner, id);
    });
  }
  async submit(owner: string, id: string, input: QuizSubmissionInput): Promise<QuizSubmission> {
    requireId(input.submissionId);
    return this.transaction(owner, async (tx) => {
      const row = await this.locked(tx, owner, id);
      const replay = await this.op(tx, owner, input.operationId, 'submit', { id, ...input });
      if (replay) return row.submission!;
      const state = await readPreparedIn(tx, owner, id);
      if (state.version.scene.type !== 'quiz') throw new QuizTraceError('INVALID_VERSION', 500);
      validateAnswers(input.answers, state.version.scene.content.questions);
      const decision = decideSubmission(row.submission ?? undefined, input);
      if (decision === 'conflict') throw new QuizTraceError('ANSWERS_LOCKED');
      if (decision === 'reuse') {
        await this.remember(
          tx,
          owner,
          input.operationId,
          row.stage_id,
          'submit',
          { id, ...input },
          { submissionId: row.submission!.id },
        );
        return row.submission!;
      }
      const now = new Date().toISOString();
      const record = await runtimeIn(tx).appendRecord(
        {
          id: randomUUID(),
          sessionId: id,
          sceneId: row.scene_id,
          createdAt: now,
          payload: {
            payloadVersion: 2,
            phase: 'submitted',
            answers: input.answers,
            versionId: row.version_id,
            submissionId: input.submissionId,
          },
        },
        { expectedLastSeq: state.lastSeq },
      );
      const submission: QuizSubmission = {
        id: input.submissionId,
        attemptId: id,
        versionId: row.version_id,
        answers: input.answers,
        recordId: record.id,
        seq: record.seq,
        savedAt: now,
      };
      await tx.query('UPDATE quiz_trace_attempts SET submission=$2::jsonb WHERE id=$1', [
        id,
        JSON.stringify(submission),
      ]);
      await this.remember(
        tx,
        owner,
        input.operationId,
        row.stage_id,
        'submit',
        { id, ...input },
        { submissionId: submission.id },
      );
      return submission;
    });
  }
  async beginReview(
    owner: string,
    id: string,
    input: QuizReviewInput,
  ): Promise<QuizReviewReservation> {
    requireId(input.submissionId);
    if (
      typeof input.language !== 'string' ||
      !/^[A-Za-z]{2,3}(-[A-Za-z]{2,8})?$/.test(input.language)
    )
      throw new QuizTraceError('INVALID_LANGUAGE', 400);
    return this.transaction(owner, async (tx) => {
      const row = await this.locked(tx, owner, id);
      if (!row.submission || row.submission.id !== input.submissionId)
        throw new QuizTraceError('SUBMISSION_MISMATCH');
      const replay = await this.op(tx, owner, input.operationId, 'review', { id, ...input });
      const state = await readPreparedIn(tx, owner, id);
      if (state.version.scene.type !== 'quiz') throw new QuizTraceError('INVALID_VERSION', 500);
      if (replay) {
        const r = await tx.query<
          { id: string; ordinal: number; result: QuizReview | null } & Record<string, unknown>
        >('SELECT id,ordinal,result FROM quiz_trace_reviews WHERE id=$1', [replay.reviewId]);
        if (!r.rows[0]) throw new QuizTraceError('REVIEW_NOT_FOUND', 404);
        return {
          id: r.rows[0].id,
          attemptId: id,
          submissionId: input.submissionId,
          versionId: row.version_id,
          ordinal: r.rows[0].ordinal,
          language: input.language,
          questions: state.version.scene.content.questions,
          answers: row.submission.answers,
          ...(r.rows[0].result ? { existing: r.rows[0].result } : { pending: true }),
        };
      }
      const n = await tx.query<{ n: number } & Record<string, unknown>>(
        'SELECT COALESCE(MAX(ordinal),0)::integer+1 AS n FROM quiz_trace_reviews WHERE attempt_id=$1',
        [id],
      );
      const reviewId = randomUUID(),
        ordinal = n.rows[0].n;
      await tx.query(
        'INSERT INTO quiz_trace_reviews(id,attempt_id,submission_id,version_id,ordinal,language) VALUES($1,$2,$3,$4,$5,$6)',
        [reviewId, id, input.submissionId, row.version_id, ordinal, input.language],
      );
      await this.remember(
        tx,
        owner,
        input.operationId,
        row.stage_id,
        'review',
        { id, ...input },
        { reviewId },
      );
      return {
        id: reviewId,
        attemptId: id,
        submissionId: input.submissionId,
        versionId: row.version_id,
        ordinal,
        language: input.language,
        questions: state.version.scene.content.questions,
        answers: row.submission.answers,
      };
    });
  }
  async finishReview(
    owner: string,
    reservation: QuizReviewReservation,
    evaluation: QuizEvaluation,
  ): Promise<QuizReview> {
    return this.transaction(owner, async (tx) => {
      const row = await this.locked(tx, owner, reservation.attemptId);
      const r = await tx.query<
        {
          id: string;
          submission_id: string;
          version_id: string;
          ordinal: number;
          result: QuizReview | null;
        } & Record<string, unknown>
      >('SELECT * FROM quiz_trace_reviews WHERE id=$1 AND attempt_id=$2 FOR UPDATE', [
        reservation.id,
        row.id,
      ]);
      const stored = r.rows[0];
      if (
        !stored ||
        stored.submission_id !== row.submission?.id ||
        stored.version_id !== row.version_id ||
        stored.submission_id !== reservation.submissionId ||
        stored.ordinal !== reservation.ordinal
      )
        throw new QuizTraceError('REVIEW_MISMATCH');
      if (stored.result) return stored.result;
      const state = await readPreparedIn(tx, owner, row.id);
      if (state.version.scene.type !== 'quiz') throw new QuizTraceError('INVALID_VERSION', 500);
      const qs = state.version.scene.content.questions;
      if (
        evaluation.results.length !== qs.length ||
        qs.some((q) => evaluation.results.filter((r) => r.questionId === q.id).length !== 1) ||
        evaluation.results.some(
          (r) =>
            !Number.isFinite(r.earned) ||
            !['normal', 'failed', 'fallback'].includes(r.evaluation?.state),
        )
      )
        throw new QuizTraceError('INVALID_EVALUATION', 400);
      const review: QuizReview = {
        ...evaluation,
        summary: projectQuizScore(evaluation.results, qs),
        id: stored.id,
        attemptId: row.id,
        submissionId: stored.submission_id,
        versionId: stored.version_id,
        ordinal: stored.ordinal,
        savedAt: new Date().toISOString(),
      };
      await tx.query('UPDATE quiz_trace_reviews SET result=$2::jsonb WHERE id=$1', [
        stored.id,
        JSON.stringify(review),
      ]);
      if (!state.review) {
        const records = await runtimeIn(tx).listRecords(row.id);
        const session = await runtimeIn(tx).getSession(row.id);
        if (session?.status === 'active')
          await runtimeIn(tx).appendRecord(
            {
              id: randomUUID(),
              sessionId: row.id,
              sceneId: row.scene_id,
              createdAt: review.savedAt,
              payload: {
                payloadVersion: 2,
                phase: 'reviewed',
                answers: row.submission!.answers,
                versionId: row.version_id,
                submissionId: stored.submission_id,
                reviewId: review.id,
                results: review.results,
              },
            },
            {
              expectedLastSeq: records.at(-1)!.seq,
              sessionTransition: { status: 'completed', updatedAt: review.savedAt },
            },
          );
      }
      if (!state.review || review.ordinal >= state.review.ordinal)
        await tx.query('UPDATE quiz_trace_attempts SET current_review_id=$2 WHERE id=$1', [
          row.id,
          review.id,
        ]);
      return review;
    });
  }
}
