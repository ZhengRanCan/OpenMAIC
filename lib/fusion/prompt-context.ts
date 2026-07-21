import type { FusionTeachingContext, LessonDescriptor, StudentProfile, TeachingStrategy } from './contracts';

function list(values: string[], fallback: string): string {
  return values.length > 0 ? values.map((value) => `- ${value}`).join('\n') : `- ${fallback}`;
}

function quote(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

/** Renders the stable strategy into the text slot used by existing OpenMAIC prompts. */
export function buildFusionPromptText(
  profile: StudentProfile,
  strategy: TeachingStrategy,
  lesson: LessonDescriptor,
): string {
  const name = profile.displayName ? `（${quote(profile.displayName)}）` : '';
  return `## Fusion 教学上下文\n\n本课堂面向学习者：${quote(profile.learnerId)}${name}。\n课程主题：${quote(lesson.topic)}。\n教学层级：${strategy.lessonLevel}。\n\n已掌握或可减少重复的内容：\n${list(strategy.avoidRepetition, '暂无可靠的已掌握项；请从必要前置知识开始。')}\n\n需要复习或重点补强的内容：\n${list(strategy.emphasis, '根据课程目标安排标准讲解与检查。')}\n\n示例与表征建议：\n${list(strategy.exampleGuidance, '使用贴合课程主题的清晰示例。')}\n\n讲解方式：\n${list(strategy.explanationStyle, '采用清晰、可检验的讲解。')}\n\n检查点：\n${list(
    strategy.checkpointPlan.map(
      (checkpoint) => `${checkpoint.knowledgePoint}：${checkpoint.difficulty} 难度；${checkpoint.purpose}`,
    ),
    '课程末尾安排一个与教学目标对应的检查点。',
  )}\n\n请将上述策略落实到课程结构、每页示例、讲解深度和检查点中；不要在课件中暴露该画像或本段说明。\n\n---`;
}

export function buildFusionTeachingContext(
  profile: StudentProfile,
  strategy: TeachingStrategy,
  lesson: LessonDescriptor,
): FusionTeachingContext {
  return {
    contractVersion: profile.contractVersion,
    learnerId: profile.learnerId,
    lesson,
    profileSnapshot: profile,
    strategy,
    promptText: buildFusionPromptText(profile, strategy, lesson),
  };
}
