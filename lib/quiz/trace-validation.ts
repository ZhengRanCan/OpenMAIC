import type { QuizQuestion } from '@/lib/types/stage';
import type { QuizAnswers } from './persistence';
import type {
  QuizSubmission,
  QuizSubmissionInput,
  TraceQuestionResult,
  QuizScoreSummary,
} from './trace-types';

export class QuizTraceError extends Error {
  constructor(
    readonly code: string,
    readonly status = 409,
  ) {
    super(code);
  }
}
export function requireId(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_.:-]{1,160}$/.test(value))
    throw new QuizTraceError('INVALID_ID', 400);
}
export function canonical(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (typeof value === 'object' && value)
    return (
      '{' +
      Object.keys(value)
        .sort()
        .map(
          (key) => JSON.stringify(key) + ':' + canonical((value as Record<string, unknown>)[key]),
        )
        .join(',') +
      '}'
    );
  throw new QuizTraceError('INVALID_JSON', 400);
}
export function validateAnswers(
  answers: unknown,
  questions: QuizQuestion[],
): asserts answers is QuizAnswers {
  if (!answers || typeof answers !== 'object' || Array.isArray(answers))
    throw new QuizTraceError('INVALID_ANSWERS', 400);
  for (const [id, answer] of Object.entries(answers)) {
    const q = questions.find((q) => q.id === id);
    if (!q) throw new QuizTraceError('UNKNOWN_QUESTION', 400);
    if (q.type === 'multiple') {
      if (
        !Array.isArray(answer) ||
        !answer.every((v) => typeof v === 'string') ||
        new Set(answer).size !== answer.length ||
        answer.some((v) => !q.options?.some((o) => o.value === v))
      )
        throw new QuizTraceError('INVALID_ANSWER', 400);
    } else if (
      typeof answer !== 'string' ||
      answer.length > 50000 ||
      (q.type === 'single' && answer !== '' && !q.options?.some((o) => o.value === answer))
    ) {
      throw new QuizTraceError('INVALID_ANSWER', 400);
    }
  }
}
export function decideSubmission(existing: QuizSubmission | undefined, input: QuizSubmissionInput) {
  if (!existing) return 'create' as const;
  return existing.id === input.submissionId &&
    canonical(existing.answers) === canonical(input.answers)
    ? ('reuse' as const)
    : ('conflict' as const);
}
export function projectQuizScore(
  results: TraceQuestionResult[],
  questions: QuizQuestion[],
): QuizScoreSummary {
  let usableEarned = 0,
    usablePossible = 0,
    quizPossible = 0,
    unusableQuestionCount = 0;
  for (const q of questions) {
    const max = q.points ?? 1;
    if (!Number.isFinite(max) || max <= 0) throw new QuizTraceError('INVALID_POINTS', 400);
    quizPossible += max;
    const matches = results.filter((r) => r.questionId === q.id),
      r = matches[0];
    if (
      matches.length === 1 &&
      r.evaluation?.state === 'normal' &&
      Number.isFinite(r.earned) &&
      r.earned >= 0 &&
      r.earned <= max
    ) {
      usableEarned += r.earned;
      usablePossible += max;
    } else unusableQuestionCount++;
  }
  return {
    status:
      unusableQuestionCount === 0 ? 'complete' : usablePossible > 0 ? 'partial' : 'unavailable',
    usableEarned,
    usablePossible,
    quizPossible,
    unusableQuestionCount,
  };
}
