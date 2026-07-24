import { describe, expect, it } from 'vitest';
import {
  appendFusionTeachingPrompt,
  createFusionDemoLessonSession,
  lookupFusionLessonSession,
} from '@/lib/fusion/session-catalog';

function mustCreate(demoStudent: 'a' | 'b') {
  const result = createFusionDemoLessonSession(demoStudent, '请生成一次函数的课堂');
  if (!result.ok) throw new Error('Expected demo session creation to succeed');
  return result.session;
}

describe('F02 演示会话目录', () => {
  it('为 A/B 返回不同且固定的教学投影', () => {
    const a = mustCreate('a');
    const b = mustCreate('b');

    expect(a.id).not.toBe(b.id);
    expect(a.teaching.lessonLevel).toBe('foundation');
    expect(b.teaching.lessonLevel).toBe('advanced');
    expect(a.promptText).toContain('斜率与截距的现实含义');
    expect(b.promptText).toContain('带有约束条件的真实问题');
  });

  it('拒绝未知演示学生和非一次函数主题', () => {
    expect(createFusionDemoLessonSession('unknown', '一次函数')).toEqual({
      ok: false,
      reason: 'unknown_demo_student',
    });
    expect(createFusionDemoLessonSession('a', '请生成二次函数课堂')).toEqual({
      ok: false,
      reason: 'unsupported_topic',
    });
  });

  it('仅保留最小化的策略投影，不含真实身份或 L3 审阅材料', () => {
    const catalogText = JSON.stringify([mustCreate('a'), mustCreate('b')]);
    const promptText = mustCreate('a').promptText;

    expect(catalogText).not.toContain('demo-student-a');
    expect(catalogText).not.toContain('learnerId');
    expect(catalogText).not.toContain('l3Profile');
    expect(catalogText).not.toContain('evidence');
    expect(promptText).not.toContain('演示学生 A');
    expect(promptText).not.toContain('demo-student-a');
  });

  it('只解析已发布的 opaque session id，且普通生成不改变原提示词', () => {
    const a = mustCreate('a');
    expect(lookupFusionLessonSession(a.id)).toEqual({ kind: 'resolved', session: a });
    expect(lookupFusionLessonSession('forged-session')).toEqual({ kind: 'invalid' });
    expect(lookupFusionLessonSession(undefined)).toEqual({ kind: 'none' });
    expect(appendFusionTeachingPrompt('原有指令', undefined)).toBe('原有指令');
  });
});
