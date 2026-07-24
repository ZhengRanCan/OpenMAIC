import { FUSION_DEMO_TOPIC, isSupportedFusionDemoTopic } from './topic';

/** 浏览器在创建会话前提交的演示选项；不对应真实用户身份。 */
export type FusionDemoStudentSelection = 'a' | 'b';

export type FusionLessonLevel = 'foundation' | 'advanced';

/**
 * 经人工审阅后发布到 OpenMAIC 的最小化 F01 v1 投影。
 *
 * 它刻意不包含 StudentProfile、learnerId、L3 文本、evidence、Provider 或
 * 策略推导逻辑。运行时只允许通过固定 session id 取得最终 promptText。
 */
export interface FusionLessonSessionProjection {
  readonly id: string;
  readonly sourceVersion: 'F01-v1';
  readonly topic: typeof FUSION_DEMO_TOPIC;
  readonly demo: {
    readonly label: string;
    readonly synthetic: true;
  };
  readonly teaching: {
    readonly lessonLevel: FusionLessonLevel;
    readonly summary: string;
  };
  readonly promptText: string;
}

export type FusionSessionLookup =
  | { readonly kind: 'none' }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'resolved'; readonly session: FusionLessonSessionProjection };

export type FusionDemoSessionCreation =
  | { readonly ok: true; readonly session: FusionLessonSessionProjection }
  | { readonly ok: false; readonly reason: 'unknown_demo_student' | 'unsupported_topic' };

const DEMO_A_PROMPT_TEXT = `## Fusion 教学上下文

课程主题：一次函数。
教学层级：foundation。

已显示相对熟悉、可减少重复的内容：
- 能够从图像判断函数的增减趋势

建议优先检查或补强的内容：
- 斜率与截距的现实含义
- 由实际情境建立函数关系

示例与表征建议：
- 优先使用生活化的计费或路程问题
- 先以具体情境引入抽象概念
- 关键概念同时使用图像或图表表达

讲解方式：
- 采用循序渐进的讲解节奏，并显式说明每一步的原因
- 将解题或推导拆分为清晰步骤

检查点：
- 斜率与截距的现实含义：easy 难度；检查并巩固“斜率与截距的现实含义”的理解。
- 由实际情境建立函数关系：easy 难度；检查并巩固“由实际情境建立函数关系”的理解。

请将上述策略落实到课程结构、每页示例、讲解深度和检查点中；不要在课件中暴露该画像或本段说明。

---`;

const DEMO_B_PROMPT_TEXT = `## Fusion 教学上下文

课程主题：一次函数。
教学层级：advanced。

已显示相对熟悉、可减少重复的内容：
- 能在图像、解析式和实际情境之间转换
- 能解释斜率与截距
- 一次函数图像与基本变化趋势
- 斜率与截距的现实含义
- 由实际情境建立函数关系

建议优先检查或补强的内容：
- 根据课程目标安排标准讲解与检查。

示例与表征建议：
- 优先使用带有约束条件的真实问题
- 关键概念同时使用图像或图表表达
- 在直观解释后给出公式化表达

讲解方式：
- 压缩已掌握基础内容，尽快进入综合或挑战性任务

检查点：
- 课程末尾安排一个与教学目标对应的检查点。

请将上述策略落实到课程结构、每页示例、讲解深度和检查点中；不要在课件中暴露该画像或本段说明。

---`;

const FUSION_DEMO_SESSION_CATALOG: Readonly<
  Record<FusionDemoStudentSelection, FusionLessonSessionProjection>
> = {
  a: {
    id: 'fusion-demo-linear-function-a-v1',
    sourceVersion: 'F01-v1',
    topic: FUSION_DEMO_TOPIC,
    demo: {
      label: '演示学生 A',
      synthetic: true,
    },
    teaching: {
      lessonLevel: 'foundation',
      summary: '以慢节奏、图像和分步骤讲解补强斜率、截距与情境建模。',
    },
    promptText: DEMO_A_PROMPT_TEXT,
  },
  b: {
    id: 'fusion-demo-linear-function-b-v1',
    sourceVersion: 'F01-v1',
    topic: FUSION_DEMO_TOPIC,
    demo: {
      label: '演示学生 B',
      synthetic: true,
    },
    teaching: {
      lessonLevel: 'advanced',
      summary: '压缩已掌握基础内容，转入公式、图像和带约束条件的挑战任务。',
    },
    promptText: DEMO_B_PROMPT_TEXT,
  },
};

const FUSION_DEMO_SESSIONS = Object.values(FUSION_DEMO_SESSION_CATALOG);

function isDemoStudentSelection(value: unknown): value is FusionDemoStudentSelection {
  return value === 'a' || value === 'b';
}

/**
 * 服务端创建（实际为选择）固定的冻结演示会话。
 * 静态目录使无状态部署中的后续三条生成请求也能解析同一份快照。
 */
export function createFusionDemoLessonSession(
  demoStudent: unknown,
  requirement: unknown,
): FusionDemoSessionCreation {
  if (!isDemoStudentSelection(demoStudent)) {
    return { ok: false, reason: 'unknown_demo_student' };
  }
  if (typeof requirement !== 'string' || !isSupportedFusionDemoTopic(requirement)) {
    return { ok: false, reason: 'unsupported_topic' };
  }

  return { ok: true, session: FUSION_DEMO_SESSION_CATALOG[demoStudent] };
}

/** 解析来自浏览器的 opaque session id；未知或畸形值不会返回内部信息。 */
export function lookupFusionLessonSession(sessionId: unknown): FusionSessionLookup {
  if (sessionId === undefined || sessionId === null || sessionId === '') {
    return { kind: 'none' };
  }
  if (typeof sessionId !== 'string') {
    return { kind: 'invalid' };
  }

  const session = FUSION_DEMO_SESSIONS.find((candidate) => candidate.id === sessionId);
  return session ? { kind: 'resolved', session } : { kind: 'invalid' };
}

/**
 * 将经目录审阅的教学上下文添加到现有 prompt 槽位。
 * 未启用融合时按原样返回 baseText，避免改变普通生成的提示词。
 */
export function appendFusionTeachingPrompt(
  baseText: string | undefined,
  session: FusionLessonSessionProjection | undefined,
): string | undefined {
  if (!session) return baseText;
  return baseText ? `${baseText}\n\n${session.promptText}` : session.promptText;
}
