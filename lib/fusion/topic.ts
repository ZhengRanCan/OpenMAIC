/**
 * F02 演示目前只覆盖一个经 F01 审阅过的课程主题。
 *
 * 此文件可被客户端用于控制演示入口，不包含学生画像、策略或提示词。
 */
export const FUSION_DEMO_TOPIC = '一次函数' as const;

export function isSupportedFusionDemoTopic(requirement: string): boolean {
  return requirement.includes(FUSION_DEMO_TOPIC);
}
