import { describe, expect, it } from 'vitest';
import { DeepTutorFusionProfileProvider } from '@/lib/fusion/deeptutor-provider';
import { MockFusionProfileProvider } from '@/lib/fusion/mock-provider';
import { buildFusionTeachingContext } from '@/lib/fusion/prompt-context';
import { createFusionLessonSession } from '@/lib/fusion/session';
import { buildTeachingStrategy } from '@/lib/fusion/strategy-builder';

describe('Fusion Adapter foundation', () => {
  it('turns the foundation demo profile into inspectable teaching guidance', async () => {
    const profile = await new MockFusionProfileProvider().getStudentProfile({
      learnerId: 'demo-student-a',
      topic: '一次函数',
    });
    const strategy = buildTeachingStrategy(profile);
    const context = buildFusionTeachingContext(profile, strategy, { topic: '一次函数' });
    const session = createFusionLessonSession(context, {
      id: 'fusion-test',
      createdAt: '2026-01-01T00:00:00.000Z',
    });

    expect(strategy.lessonLevel).toBe('foundation');
    expect(strategy.emphasis).toContain('斜率与截距的现实含义');
    expect(context.promptText).toContain('出租车');
    expect(session.context.profileSnapshot.learnerId).toBe('demo-student-a');
  });

  it('normalizes a DeepTutor profile without leaking the provider response shape', async () => {
    const provider = new DeepTutorFusionProfileProvider({
      baseUrl: 'http://deeptutor.local/',
      fetchFn: (async () =>
        new Response(
          JSON.stringify({
            profile: {
              learnerId: 'learner-1',
              displayName: '小林',
              knowledgeState: [
                {
                  knowledgePointId: 'kp-1',
                  name: '一次函数',
                  mastery: 1.4,
                  evidence: ['课堂测验'],
                },
              ],
              strengths: ['图像识读'],
              weakPoints: ['建模'],
              learningPreferences: { pace: 'slow', preferredRepresentations: ['visual'] },
              recentMisconceptions: [],
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )) as typeof fetch,
    });

    const profile = await provider.getStudentProfile({ learnerId: 'learner-1', topic: '一次函数' });

    expect(profile.source).toBe('deeptutor');
    expect(profile.knowledgeState[0].mastery).toBe(1);
    expect(profile.learningPreferences.preferredRepresentations).toEqual(['visual']);
  });
});
