import type { NextRequest } from 'next/server';
import { callLLM } from '@/lib/ai/llm';
import { resolveModelFromRequest } from '@/lib/server/resolve-model';
import { gradeChoiceQuestions, toArray } from '@/lib/quiz/grading';
import { projectQuizScore } from '@/lib/quiz/trace-validation';
import type {
  QuizReviewReservation,
  QuizEvaluation,
  TraceQuestionResult,
} from '@/lib/quiz/trace-types';

export function parseQuizGrade(
  text: string,
  points: number,
): { score: number; comment: string } | undefined {
  try {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return;
    const p = JSON.parse(match[0]);
    if (typeof p.score !== 'number' || !Number.isFinite(p.score)) return;
    return {
      score: Math.max(0, Math.min(points, Math.round(p.score))),
      comment: typeof p.comment === 'string' ? p.comment : '',
    };
  } catch {
    return;
  }
}
export async function gradeSubmittedQuiz(
  req: NextRequest,
  context: QuizReviewReservation,
): Promise<QuizEvaluation> {
  const { questions, answers, language } = context;
  let model: Awaited<ReturnType<typeof resolveModelFromRequest>> | undefined;
  if (questions.some((q) => q.type === 'short_answer')) {
    try {
      model = await resolveModelFromRequest(req, {}, 'quiz-grade');
    } catch {
      /* explicit per-question failure */
    }
  }
  const results = await Promise.all(
    questions.map(async (q): Promise<TraceQuestionResult> => {
      const points = q.points ?? 1;
      if (q.type !== 'short_answer') {
        const keys = toArray(q.answer);
        if (
          !keys.length ||
          keys.some(
            (a) =>
              q.options?.filter((o) => o.value === a).length !== 1 &&
              q.options?.filter((o) => o.label === a).length !== 1,
          )
        )
          return {
            questionId: q.id,
            correct: null,
            status: 'incorrect',
            earned: 0,
            evaluation: {
              state: 'failed',
              method: 'exact-key',
              reason: 'invalid-answer-key',
              rule: 'exact-unique-option-v1',
            },
          };
        return {
          ...gradeChoiceQuestions([q], answers)[0],
          evaluation: { state: 'normal', method: 'exact-key', rule: 'exact-unique-option-v1' },
        };
      }
      const execution = {
        method: 'model' as const,
        rule: 'quiz-short-prompt-v1',
        ...(model ? { configuredModel: model.modelString } : {}),
      };
      if (!model)
        return {
          questionId: q.id,
          correct: null,
          status: 'incorrect',
          earned: 0,
          evaluation: { ...execution, state: 'failed', reason: 'model-unavailable' },
        };
      const isZh = language.startsWith('zh');
      const system = isZh
        ? `你是一位专业的教育评估专家。请根据题目和学生答案进行评分并给出简短评语。
必须以如下 JSON 格式回复（不要包含其他内容）：
{"score": <0到${points}的整数>, "comment": "<一两句评语>"}`
        : `You are a professional educational assessor. Grade the student's answer and provide brief feedback.
You must reply in the following JSON format only (no other content):
{"score": <integer from 0 to ${points}>, "comment": "<one or two sentences of feedback>"}`;
      const answer = answers[q.id];
      const text = Array.isArray(answer) ? answer.join(', ') : (answer ?? '');
      const prompt = isZh
        ? `题目：${q.question}
满分：${points}分
${q.commentPrompt ? `评分要点：${q.commentPrompt}\n` : ''}学生答案：${text}`
        : `Question: ${q.question}
Full marks: ${points} points
${q.commentPrompt ? `Grading guidance: ${q.commentPrompt}\n` : ''}Student answer: ${text}`;
      try {
        const output = await callLLM(
          { model: model.model, system, prompt },
          'quiz-grade',
          undefined,
          model.thinkingConfig,
          { serverManaged: model.serverManaged },
        );
        const parsed = parseQuizGrade(output.text, points);
        if (!parsed)
          return {
            questionId: q.id,
            correct: null,
            status: 'incorrect',
            earned: Math.round(points * 0.5),
            evaluation: { ...execution, state: 'fallback', reason: 'invalid-model-result' },
          };
        return {
          questionId: q.id,
          correct: parsed.score === points,
          status: parsed.score === points ? 'correct' : 'incorrect',
          earned: parsed.score,
          aiComment: parsed.comment,
          evaluation: { ...execution, state: 'normal' },
        };
      } catch {
        return {
          questionId: q.id,
          correct: null,
          status: 'incorrect',
          earned: 0,
          evaluation: { ...execution, state: 'failed', reason: 'model-request-failed' },
        };
      }
    }),
  );
  return { results, summary: projectQuizScore(results, questions) };
}
