import { describe, expect, it } from 'vitest';
import type { PreparedQuiz } from '@/lib/quiz/trace-types';
import { projectShortFactsContext } from '@/lib/evidence/short-facts-context';

function source(): PreparedQuiz {
  return {
    attemptId: 'attempt',
    stageId: 'stage',
    sceneId: 'scene',
    lastSeq: 1,
    answers: { q: 'B' },
    reviews: [],
    submission: {
      id: 'submission',
      attemptId: 'attempt',
      versionId: 'version',
      answers: { q: 'B' },
      recordId: 'record',
      seq: 1,
      savedAt: '2026-10-27T00:00:00Z',
    },
    version: {
      id: 'version',
      capturedAt: '2026-10-27T00:00:00Z',
      resources: [],
      resourceCoverage: { taskPresentation: 'text-and-math-quiz', unavailableBackgroundRefs: [] },
      scene: {
        id: 'scene',
        stageId: 'stage',
        title: 'Quiz',
        order: 0,
        type: 'quiz',
        content: {
          type: 'quiz',
          questions: [
            {
              id: 'q',
              type: 'single',
              question: '选择正确答案',
              options: [{ value: 'B', label: '正确选项' }],
              answer: ['B'],
              analysis: '参考解析',
              points: 99,
              commentPrompt: 'PRIVATE_GRADING',
            },
          ],
        },
      },
    },
  };
}
describe('formal Trace projection', () => {
  it('contains original answer and reference but excludes grading and draft state', () => {
    const quiz = source();
    quiz.answers = { q: 'draft should not appear' };
    const result = projectShortFactsContext(quiz, ['代理已接触参考答案']);
    expect(result.user).toContain('正确选项');
    expect(result.user).toContain('参考解析');
    expect(result.user).not.toContain('PRIVATE_GRADING');
    expect(result.user).not.toContain('draft should not appear');
    expect(result.user).not.toContain('points');
    expect(Object.values(result.refs)[0].traceRef).toContain('submission:submission/question:q');
  });
  it('rejects missing or mismatched formal submissions', () => {
    const missing = source();
    delete missing.submission;
    expect(() => projectShortFactsContext(missing, ['代理作答'])).toThrow();
    const wrong = source();
    wrong.submission!.versionId = 'other';
    expect(() => projectShortFactsContext(wrong, ['代理作答'])).toThrow();
    expect(() => projectShortFactsContext(source(), [])).toThrow();
  });
});
