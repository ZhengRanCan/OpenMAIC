import type { StudentProfile, TeachingStrategy } from './contracts';
import { FUSION_CONTRACT_VERSION } from './contracts';

const REVIEW_THRESHOLD = 0.65;
const STRONG_THRESHOLD = 0.8;

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function levelFor(profile: StudentProfile): TeachingStrategy['lessonLevel'] {
  if (profile.knowledgeState.length === 0) return 'foundation';
  const average =
    profile.knowledgeState.reduce((sum, point) => sum + point.mastery, 0) /
    profile.knowledgeState.length;
  if (average >= STRONG_THRESHOLD && profile.weakPoints.length === 0) return 'advanced';
  return average < REVIEW_THRESHOLD ? 'foundation' : 'standard';
}

/** Converts a learner snapshot into deterministic, inspectable lesson guidance. */
export function buildTeachingStrategy(profile: StudentProfile): TeachingStrategy {
  const weakKnowledge = profile.knowledgeState
    .filter((point) => point.mastery < REVIEW_THRESHOLD)
    .map((point) => point.name);
  const strongKnowledge = profile.knowledgeState
    .filter((point) => point.mastery >= STRONG_THRESHOLD)
    .map((point) => point.name);
  const emphasis = unique([
    ...profile.weakPoints,
    ...weakKnowledge,
    ...profile.recentMisconceptions.map((item) => item.knowledgePoint),
  ]);
  const representations = profile.learningPreferences.preferredRepresentations ?? [];
  const pace = profile.learningPreferences.pace ?? 'standard';
  const exampleGuidance = unique([
    ...(profile.learningPreferences.preferredExamples ?? []).map((example) => `优先使用${example}`),
    ...(representations.includes('concrete') ? ['先以具体情境引入抽象概念'] : []),
    ...(representations.includes('visual') ? ['关键概念同时使用图像或图表表达'] : []),
    ...(representations.includes('formula') ? ['在直观解释后给出公式化表达'] : []),
  ]);

  return {
    contractVersion: FUSION_CONTRACT_VERSION,
    lessonLevel: levelFor(profile),
    prerequisiteReview: emphasis,
    emphasis,
    avoidRepetition: unique([...profile.strengths, ...strongKnowledge]),
    exampleGuidance,
    explanationStyle: unique([
      pace === 'slow' ? '采用循序渐进的讲解节奏，并显式说明每一步的原因' : '',
      pace === 'fast' ? '压缩已掌握基础内容，尽快进入综合或挑战性任务' : '',
      pace === 'standard' ? '采用标准节奏，先解释再练习' : '',
      ...(representations.includes('step_by_step') ? ['将解题或推导拆分为清晰步骤'] : []),
    ]),
    checkpointPlan: emphasis.slice(0, 3).map((knowledgePoint) => ({
      knowledgePoint,
      difficulty: levelFor(profile) === 'advanced' ? 'hard' : levelFor(profile) === 'foundation' ? 'easy' : 'medium',
      purpose: `检查并巩固“${knowledgePoint}”的理解。`,
    })),
  };
}
