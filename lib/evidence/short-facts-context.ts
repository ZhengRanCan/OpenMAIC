import { evidenceDigest, validatePreparedSource } from '@/lib/evidence/context';
import type { PreparedQuiz } from '@/lib/quiz/trace-types';
import type { TraceRef } from './short-facts';
import { EVIDENCE_LIMITS } from '@/lib/evidence/contracts';

export const SHORT_FACTS_CONTEXT_VERSION = 'trace-short-facts.v1';
export const TASK_ENTRY =
  '# 本次抽取任务\n\n' +
  '请从以下Quiz作答记录中提取有来源支持的学习表现候选，用于测试后续Memory事实整理。\n\n' +
  '可以提取：\n- 实际选择体现的具体正确或错误表现；\n- 实际写出的正确步骤、错误方法或解释；\n- 有明确依据的重复错误或表现差异。\n\n' +
  '本次记录即使全部正确、没有写理由、仅有一次提交，也可能包含有价值的候选。不得将这些表现上升为真实学生的长期能力结论。\n' +
  '来源条件用于限定真实学生归属与Memory采用资格，不妨碍本次对模拟作答内容的分析。\n\n';

/** Input must already be fetched under an authorized owner and bound to a simulated identity. */
export function projectShortFactsContext(quiz: PreparedQuiz, conditions: string[]) {
  validatePreparedSource(quiz);
  const submission = quiz.submission!;
  const scene = quiz.version.scene;
  if (scene.type !== 'quiz') throw new Error('INVALID_QUIZ');
  if (quiz.version.resourceCoverage!.unavailableBackgroundRefs.length)
    throw new Error('SOURCE_BACKGROUND_UNAVAILABLE');
  if (!conditions.length || conditions.some((x) => !x.trim()))
    throw new Error('SOURCE_CONDITIONS_REQUIRED');
  const refs: Record<string, TraceRef> = {};
  const entities = scene.content.questions.map((q) => {
    const traceRef = `stage:${quiz.stageId}/scene:${quiz.sceneId}/version:${quiz.version.id}/attempt:${quiz.attemptId}/submission:${submission.id}/question:${q.id}`;
    const ref = `quiz:${evidenceDigest({ submission: submission.id, question: q.id }).slice(0, 32)}`;
    refs[ref] = {
      questionIdentity: `${quiz.version.id}:${q.id}`,
      traceRef,
      conditions: [
        ...conditions,
        `题目内容：${q.question}`,
        ...(q.options?.length
          ? [
              `题目选项：${q.options.map((option) => `${option.value}. ${option.label}`).join('；')}`,
            ]
          : []),
      ],
    };
    const answer = Object.hasOwn(submission.answers, q.id)
      ? JSON.stringify(submission.answers[q.id])
      : '未作答';
    const options = q.options?.map((o) => `${o.value}. ${o.label}`).join('\n');
    return [
      `=== @entity ${ref} ===`,
      `ref: ${ref}`,
      `label: ${q.question}`,
      `**Question**: ${q.question}`,
      ...(options ? [`**Options**:\n${options}`] : []),
      `**User answer**: ${answer}`,
      `**Correct answer**: ${q.answer ? JSON.stringify(q.answer) : '未提供'}`,
      `**Explanation**: ${q.analysis ?? '未提供'}`,
    ].join('\n\n');
  });
  const user =
    TASK_ENTRY +
    '# 已有的 quiz 记忆（不要重复已经记录过的事实）：\n(empty — first run)\n\n# 源 chunk 1/1：\n----------------------------------------------------------------\n# Chunk-local citeable refs\n' +
    Object.keys(refs)
      .map((ref) => `- ${ref}`)
      .join('\n') +
    '\n\n' +
    entities.join('\n\n') +
    '\n----------------------------------------------------------------\n\n# 来源条件\n' +
    conditions.map((x) => `- ${x}`).join('\n') +
    '\n\n返回 JSON。只能引用上面列出或出现过的 ref。\n';
  if (Buffer.byteLength(user, 'utf8') > EVIDENCE_LIMITS.inputBytes)
    throw new Error('EVIDENCE_INPUT_TOO_LARGE');
  const source = {
    stageId: quiz.stageId,
    sceneId: quiz.sceneId,
    versionId: quiz.version.id,
    attemptId: quiz.attemptId,
    submissionId: submission.id,
    savedAt: submission.savedAt,
  };
  return {
    version: SHORT_FACTS_CONTEXT_VERSION,
    user,
    refs,
    source,
    digest: evidenceDigest({ user, refs, source }),
  };
}
