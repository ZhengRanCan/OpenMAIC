import { createHash } from 'node:crypto';
import type { PreparedQuiz } from '@/lib/quiz/trace-types';
import { validateAnswers } from '@/lib/quiz/trace-validation';
import {
  EVIDENCE_CONTEXT_VERSION,
  EVIDENCE_LIMITS,
  EvidenceError,
  evidenceIdSchema,
  type EvidenceContext,
  type EvidenceSourceEnvelope,
  type EvidenceSourceCard,
  type EvidenceSourceRole,
  type EvidenceSourceScope,
} from './contracts';

/** Canonical JSON for immutable fingerprints; never stringify credentials into this. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (typeof value === 'object' && value)
    return (
      '{' +
      Object.keys(value)
        .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
        .sort()
        .map(
          (key) =>
            JSON.stringify(key) + ':' + canonicalJson((value as Record<string, unknown>)[key]),
        )
        .join(',') +
      '}'
    );
  throw new EvidenceError('INVALID_EVIDENCE_JSON', 400);
}
export const canonical = canonicalJson;
export const evidenceDigest = (value: unknown): string =>
  createHash('sha256').update(canonicalJson(value)).digest('hex');
export const digestOf = evidenceDigest;

/** The stable factual source excludes mutable draft/current-evaluation pointers. */
export function provenanceFingerprint(quiz: PreparedQuiz): string {
  return evidenceDigest({
    attemptId: quiz.attemptId,
    stageId: quiz.stageId,
    sceneId: quiz.sceneId,
    version: quiz.version,
    submission: quiz.submission ?? null,
  });
}

export function validatePreparedSource(quiz: PreparedQuiz): void {
  const invalid = () => {
    throw new EvidenceError('INVALID_EVIDENCE_SOURCE', 409);
  };
  if (!quiz || !quiz.version || !quiz.submission || !Array.isArray(quiz.reviews)) invalid();
  const submission = quiz.submission!;
  for (const id of [
    quiz.attemptId,
    quiz.stageId,
    quiz.sceneId,
    quiz.version.id,
    submission.id,
    submission.recordId,
  ])
    if (!evidenceIdSchema.safeParse(id).success) invalid();
  if (
    submission.attemptId !== quiz.attemptId ||
    submission.versionId !== quiz.version.id ||
    !Number.isInteger(submission.seq) ||
    submission.seq < 1
  )
    invalid();
  const scene = quiz.version.scene;
  if (
    !scene ||
    scene.id !== quiz.sceneId ||
    scene.stageId !== quiz.stageId ||
    scene.type !== 'quiz' ||
    scene.content.type !== 'quiz'
  )
    invalid();
  if (scene.type !== 'quiz') return;
  const questions = scene.content.questions;
  if (
    !Array.isArray(questions) ||
    !questions.length ||
    questions.length > EVIDENCE_LIMITS.questions ||
    new Set(questions.map((q) => q.id)).size !== questions.length
  )
    invalid();
  if (
    quiz.version.resourceCoverage?.taskPresentation !== 'text-and-math-quiz' ||
    !Array.isArray(quiz.version.resourceCoverage.unavailableBackgroundRefs) ||
    !Array.isArray(quiz.version.resources)
  )
    throw new EvidenceError('SOURCE_COVERAGE_UNAVAILABLE', 409);
  try {
    validateAnswers(submission.answers, questions);
  } catch {
    invalid();
  }
  const seen = new Set<string>();
  for (const review of quiz.reviews) {
    if (
      !review ||
      !evidenceIdSchema.safeParse(review.id).success ||
      seen.has(review.id) ||
      review.attemptId !== quiz.attemptId ||
      review.submissionId !== submission.id ||
      review.versionId !== quiz.version.id ||
      !Number.isInteger(review.ordinal) ||
      review.ordinal < 1 ||
      !Array.isArray(review.results)
    )
      invalid();
    seen.add(review.id);
    const resultIds = review.results.map((r) => r.questionId);
    if (
      new Set(resultIds).size !== resultIds.length ||
      resultIds.some((id) => !questions.some((q) => q.id === id))
    )
      invalid();
  }
  if (new Set(quiz.reviews.map((review) => review.ordinal)).size !== quiz.reviews.length) invalid();
  for (const selected of [quiz.review, quiz.previousUsableReview])
    if (
      selected &&
      !quiz.reviews.some(
        (review) => review.id === selected.id && canonicalJson(review) === canonicalJson(selected),
      )
    )
      invalid();
  if (
    quiz.pendingReview &&
    (!evidenceIdSchema.safeParse(quiz.pendingReview.id).success ||
      seen.has(quiz.pendingReview.id) ||
      !Number.isInteger(quiz.pendingReview.ordinal) ||
      quiz.pendingReview.ordinal < 1)
  )
    invalid();
}

function refFor(role: EvidenceSourceRole, scope: EvidenceSourceScope, discriminator = ''): string {
  return `${role}:${evidenceDigest({ role, scope, discriminator }).slice(0, 32)}`;
}

export function buildEvidenceContext(envelope: EvidenceSourceEnvelope): EvidenceContext {
  if (envelope.schemaVersion !== 1 || envelope.related.length > 1)
    throw new EvidenceError('INVALID_EVIDENCE_SOURCE', 409);
  const all = [envelope.anchor, ...envelope.related];
  all.forEach(validatePreparedSource);
  if (
    new Set(all.map((quiz) => quiz.attemptId)).size !== all.length ||
    new Set(all.map((quiz) => quiz.submission!.id)).size !== all.length ||
    all.some(
      (quiz) =>
        quiz.stageId !== envelope.anchor.stageId ||
        quiz.sceneId !== envelope.anchor.sceneId ||
        quiz.version.id !== envelope.anchor.version.id,
    )
  )
    throw new EvidenceError('INCOMPATIBLE_EVIDENCE_SOURCES', 409);
  if (all.some((quiz) => canonicalJson(quiz.version) !== canonicalJson(envelope.anchor.version)))
    throw new EvidenceError('CONFLICTING_HISTORICAL_SOURCE', 409);
  const index: Record<string, EvidenceSourceCard> = {};
  const add = (
    role: EvidenceSourceRole,
    scope: EvidenceSourceScope,
    path: string,
    data: unknown,
    discriminator = '',
    condition?: EvidenceSourceCard['condition'],
  ) => {
    const ref = refFor(role, scope, discriminator),
      renderedText = canonicalJson(data);
    const card: EvidenceSourceCard = {
      ref,
      role,
      scope,
      path,
      contentDigest: evidenceDigest(data),
      renderedText,
      ...(condition ? { condition } : {}),
    };
    if (index[ref] && index[ref].contentDigest !== card.contentDigest)
      throw new EvidenceError('CONFLICTING_HISTORICAL_SOURCE', 409);
    index[ref] ??= card;
  };
  for (const quiz of all) {
    const base: EvidenceSourceScope = {
      stageId: quiz.stageId,
      sceneId: quiz.sceneId,
      versionId: quiz.version.id,
    };
    const submission = quiz.submission!;
    const answerBase = { ...base, attemptId: quiz.attemptId, submissionId: submission.id };
    const scene = quiz.version.scene;
    if (scene.type !== 'quiz') throw new EvidenceError('INVALID_EVIDENCE_SOURCE', 409);
    const { content: _content, ...sceneMetadata } = scene;
    add('version', base, 'version', {
      id: quiz.version.id,
      capturedAt: quiz.version.capturedAt,
      scene: sceneMetadata,
      resourceCoverage: quiz.version.resourceCoverage,
    });
    add('resource', base, 'version.resources', quiz.version.resources);
    if (quiz.version.planning !== undefined)
      add('planning', base, 'version.planning', quiz.version.planning);
    for (const question of scene.content.questions) {
      const taskDigest = evidenceDigest(question);
      const taskScope = { ...base, questionId: question.id, taskDigest };
      const { answer, analysis, commentPrompt, ...task } = question;
      add('task', taskScope, `version.scene.content.questions[${question.id}]`, task);
      add(
        'rubric',
        taskScope,
        `version.scene.content.questions[${question.id}].evaluationDefinition`,
        {
          ...(answer !== undefined ? { answer } : {}),
          ...(analysis !== undefined ? { analysis } : {}),
          ...(commentPrompt !== undefined ? { commentPrompt } : {}),
          points: question.points ?? 1,
        },
      );
      add(
        'answer',
        { ...answerBase, questionId: question.id, taskDigest },
        `submission.answers[${question.id}]`,
        {
          answer: submission.answers[question.id] ?? null,
          submitted: Object.hasOwn(submission.answers, question.id),
          recordId: submission.recordId,
          seq: submission.seq,
          savedAt: submission.savedAt,
        },
      );
    }
    for (const review of quiz.reviews)
      add('review', { ...answerBase, reviewId: review.id }, `reviews[${review.id}]`, review);
    add('review', answerBase, 'evaluationStatus', {
      reviewId: quiz.review?.id ?? null,
      previousUsableReviewId: quiz.previousUsableReview?.id ?? null,
      pendingReview: quiz.pendingReview ?? null,
    });
    for (const condition of envelope.conditions.filter((x) => x.submissionId === submission.id)) {
      if (
        condition.sourceFingerprint !== provenanceFingerprint(quiz) ||
        condition.origin !== 'f63-review'
      )
        throw new EvidenceError('PROVENANCE_MISMATCH', 409);
      add('condition', answerBase, 'confirmedConditions', condition, condition.code, condition);
    }
  }
  if (
    envelope.conditions.some(
      (condition) => !all.some((quiz) => quiz.submission!.id === condition.submissionId),
    )
  )
    throw new EvidenceError('PROVENANCE_MISMATCH', 409);
  const sourceIndex = Object.fromEntries(
    Object.entries(index).sort(([a], [b]) => a.localeCompare(b)),
  );
  const text = canonicalJson({
    version: EVIDENCE_CONTEXT_VERSION,
    provenanceDigest: envelope.provenanceDigest,
    selection: {
      anchor: {
        attemptId: envelope.anchor.attemptId,
        submissionId: envelope.anchor.submission!.id,
      },
      related: envelope.related.map((quiz) => ({
        attemptId: quiz.attemptId,
        submissionId: quiz.submission!.id,
      })),
    },
    sources: Object.values(sourceIndex),
  });
  if (Buffer.byteLength(text, 'utf8') > EVIDENCE_LIMITS.inputBytes)
    throw new EvidenceError('EVIDENCE_INPUT_TOO_LARGE', 413);
  return {
    version: EVIDENCE_CONTEXT_VERSION,
    text,
    sourceIndex,
    digest: evidenceDigest({ version: EVIDENCE_CONTEXT_VERSION, text, sourceIndex }),
  };
}
