import type { FrozenLearnerContext } from './contracts';

/** Minimal Planner projection. The complete immutable source snapshot stays on the run. */
export function renderPreclassLearnerContext(context: FrozenLearnerContext): string {
  if (context.status !== 'ready') return '';
  return context.selected
    .map((piece) => {
      const conditions = [
        ...new Set([...piece.conditions, ...piece.supports.flatMap((source) => source.conditions)]),
      ];
      const sources = piece.supports.map(
        (source) => `${source.kind}（${source.sourceNature}；${source.refs.join('、')}）`,
      );
      return `${piece.text}\n条件：${conditions.join('；') || '未记录额外条件'}\n形成：${piece.formation}\n来源：${sources.join('；')}`;
    })
    .join('\n\n');
}
