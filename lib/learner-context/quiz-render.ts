import type { QuizGenerationContext } from '@openmaic/generation';
import type { FrozenQuizLearnerContext, QuizMemoryTask } from './quiz-contracts';

/** Minimal content-model projection. Full source versions and selection reasons stay on the run. */
export function renderQuizLearnerContext(
  task: QuizMemoryTask,
  context: FrozenQuizLearnerContext,
): QuizGenerationContext | undefined {
  if (context.status !== 'ready') return undefined;
  return {
    task: JSON.stringify({
      requirement: task.requirement,
      courseTitle: task.courseTitle,
      outline: task.outline,
    }),
    learner: context.selected
      .map((piece) => {
        const conditions = [
          ...new Set([
            ...piece.conditions,
            ...piece.supports.flatMap((source) => source.conditions),
          ]),
        ];
        const sources = piece.supports.map(
          (source) => `${source.kind}（${source.sourceNature}；${source.refs.join('、')}）`,
        );
        return `${piece.text}\n条件：${conditions.join('；') || '未记录额外条件'}\n形成：${piece.formation}\n来源：${sources.join('；')}`;
      })
      .join('\n\n'),
  };
}
