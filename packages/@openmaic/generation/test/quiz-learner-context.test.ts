import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  generateSceneActions,
  generateSceneContent,
  type AICallFn,
  type QuizGenerationContext,
} from '@openmaic/generation';
import { quizOutline, slideOutline, widgetOutline } from './scene-fixtures.js';

const context: QuizGenerationContext = { task: 'QUIZ_TASK_ONLY', learner: 'QUIZ_MEMORY_ONLY' };
const response = JSON.stringify([
  {
    id: 'q1',
    type: 'short_answer',
    question: 'Explain why.',
    analysis: 'Reference reasoning',
    commentPrompt: 'Award points for the reason and steps.',
    points: 10,
  },
]);
const hash = (text: string) =>
  createHash('sha256').update(text.replace(/\r\n/g, '\n')).digest('hex');

describe('quiz learner context prompt slot', () => {
  it('preserves the pre-F66 no-context prompts and short-answer fields', async () => {
    const aiCall = vi.fn<AICallFn>(async () => response);
    const result = await generateSceneContent(quizOutline(), aiCall);
    const [system, user] = aiCall.mock.calls[0];
    expect(hash(system)).toBe('d1e49cc85d83a3c778f636e22328e31d76221521858d21b6338832e10efb44ee');
    expect(hash(user)).toBe('c976693f7257e96e0108ad5aa000255bd592ff3cf0a5a688d4d4d4b8162a83ac');
    expect(result).toMatchObject({
      questions: [
        {
          type: 'short_answer',
          analysis: 'Reference reasoning',
          commentPrompt: 'Award points for the reason and steps.',
          hasAnswer: false,
        },
      ],
    });
  });

  it('adds the task and historical context only to quiz generation while retaining the question contract', async () => {
    const aiCall = vi.fn<AICallFn>(async () => response);
    await generateSceneContent(quizOutline(), aiCall, { quizLearnerContext: context });
    const [system, user] = aiCall.mock.calls[0];
    expect(user).toContain(context.task);
    expect(user).toContain(context.learner);
    expect(system).toContain('question count');
    expect(system).toContain('allowed question types');
    expect(system).toContain('commentPrompt');
    expect(system).toContain('analysis');
    expect(system).toContain('historical');
  });

  it.each([slideOutline, widgetOutline])(
    'ignores the quiz slot for $type content',
    async (makeOutline) => {
      const aiCall = vi.fn<AICallFn>(async () => '{}');
      await generateSceneContent(makeOutline(), aiCall, { quizLearnerContext: context });
      expect(aiCall).toHaveBeenCalledTimes(1);
      expect(aiCall.mock.calls[0].join('\n')).not.toMatch(/QUIZ_TASK_ONLY|QUIZ_MEMORY_ONLY/);
    },
  );

  it('does not carry the slot into quiz action generation', async () => {
    const aiCall = vi.fn<AICallFn>(async () => '[]');
    await generateSceneActions(quizOutline(), { questions: [] }, aiCall);
    expect(aiCall.mock.calls[0].join('\n')).not.toMatch(/QUIZ_TASK_ONLY|QUIZ_MEMORY_ONLY/);
  });
});
