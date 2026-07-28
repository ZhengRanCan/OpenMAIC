import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SceneOutline } from '@/lib/types/generation';
import { createFusionDemoLessonSession } from '@/lib/fusion/session-catalog';

const mocks = vi.hoisted(() => ({
  callLLM: vi.fn(),
  resolveModelFromRequest: vi.fn(),
  applyOutlineFallbacks: vi.fn(),
  generateSceneContent: vi.fn(),
  generateSceneActions: vi.fn(),
  buildCompleteScene: vi.fn(),
  buildVisionUserContent: vi.fn(),
  resolveVocationalActive: vi.fn(),
  resolveFormalFusion: vi.fn(),
}));

vi.mock('@/lib/ai/llm', () => ({ callLLM: mocks.callLLM }));
vi.mock('@/lib/server/resolve-model', () => ({
  resolveModelFromRequest: mocks.resolveModelFromRequest,
}));
vi.mock('@/lib/config/feature-flags', () => ({
  resolveVocationalActive: mocks.resolveVocationalActive,
}));
vi.mock('@/lib/fusion/generation-session', () => ({
  FormalFusionError: class FormalFusionError extends Error {},
  appendFormalTeachingPrompt: (base: string | undefined) => base,
  formalFusionErrorResponse: vi.fn(),
  resolveFormalFusion: mocks.resolveFormalFusion,
}));
vi.mock('@/lib/generation/generation-pipeline', () => ({
  applyOutlineFallbacks: mocks.applyOutlineFallbacks,
  generateSceneContent: mocks.generateSceneContent,
  generateSceneActions: mocks.generateSceneActions,
  buildCompleteScene: mocks.buildCompleteScene,
  buildVisionUserContent: mocks.buildVisionUserContent,
}));
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

const outline: SceneOutline = {
  id: 'outline-1',
  type: 'slide',
  title: 'Slope',
  description: 'Explain slope.',
  keyPoints: ['slope'],
  order: 1,
};

function fusionSessionId() {
  const result = createFusionDemoLessonSession('a', '请生成一次函数课堂');
  if (!result.ok) throw new Error('Expected demo session creation to succeed');
  return result.session.id;
}

function request(extraBody: Record<string, unknown> = {}) {
  return {
    json: async () => ({
      outline,
      allOutlines: [outline],
      content: { elements: [], remark: 'ok' },
      stageId: 'stage-1',
      stageInfo: { name: 'lesson' },
      languageDirective: 'Teach clearly.',
      ...extraBody,
    }),
    headers: { get: () => null },
  };
}

describe('Fusion scene routes', () => {
  beforeEach(() => {
    vi.resetModules();
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.resolveModelFromRequest.mockResolvedValue({
      model: { id: 'language-model' },
      modelInfo: { outputWindow: 4096, capabilities: {} },
      modelString: 'test:model',
      thinkingConfig: undefined,
    });
    mocks.resolveFormalFusion.mockResolvedValue({ kind: 'none' });
    mocks.applyOutlineFallbacks.mockImplementation((value) => value);
    mocks.resolveVocationalActive.mockReturnValue(false);
    mocks.generateSceneContent.mockResolvedValue({ elements: [], remark: 'ok' });
    mocks.generateSceneActions.mockResolvedValue([]);
    mocks.buildCompleteScene.mockReturnValue({
      id: 'scene-1',
      type: 'slide',
      title: outline.title,
      order: outline.order,
      content: { elements: [], remark: 'ok' },
      actions: [],
    });
  });

  it('keeps F02 Demo prompt context for the standalone demo route', async () => {
    const fusionId = fusionSessionId();
    const { POST } = await import('@/app/api/generate/scene-content/route');
    const response = await POST(
      request({ fusionSessionId: fusionId }) as unknown as Parameters<typeof POST>[0],
    );
    expect(response.status).toBe(200);
    expect(mocks.generateSceneContent.mock.calls[0][2].languageDirective).toContain('foundation');
  });

  it('removes browser profile fields and F02 Demo context for a formal session', async () => {
    const formalOutline = {
      ...outline,
      id: 'formal-outline',
      title: 'Server-owned formal outline',
      description: 'Use the frozen requirement.',
    };
    mocks.resolveFormalFusion.mockResolvedValue({
      kind: 'resolved',
      context: {
        lessonRequirement: 'Frozen formal requirement',
        lessonKnowledgePointIds: ['point-1'],
        mappingId: 'map-1',
        mappingRevision: '2',
        checkpoint: {
          checkpointId: 'checkpoint-1',
          sceneId: 'checkpoint-scene',
          remediationSceneId: 'remediation-scene',
          remediationStrategy: 'concrete_example',
        },
        guidance: ['Use conservative guidance.'],
      },
      outlines: [formalOutline],
    });
    const fusionId = fusionSessionId();
    const { POST: contentPost } = await import('@/app/api/generate/scene-content/route');
    const contentResponse = await contentPost(
      request({
        lessonSessionId: 'formal-session',
        fusionSessionId: fusionId,
        outline: { ...outline, id: 'formal-outline', title: 'forged topic' },
        requirements: {
          requirement: 'forged requirement',
          userNickname: 'forged-name',
          userBio: 'forged-bio',
        },
      }) as unknown as Parameters<typeof contentPost>[0],
    );
    expect(contentResponse.status).toBe(200);
    const contentOptions = mocks.generateSceneContent.mock.calls[0][2];
    expect(contentOptions.userRequirements).not.toHaveProperty('userNickname');
    expect(contentOptions.userRequirements).not.toHaveProperty('userBio');
    expect(contentOptions.userRequirements).toEqual({ requirement: 'Frozen formal requirement' });
    expect(contentOptions.languageDirective).toBeUndefined();
    expect(mocks.generateSceneContent.mock.calls[0][0]).toMatchObject({
      title: 'Server-owned formal outline',
    });

    vi.resetModules();
    const { POST: actionsPost } = await import('@/app/api/generate/scene-actions/route');
    const actionsResponse = await actionsPost(
      request({
        lessonSessionId: 'formal-session',
        fusionSessionId: fusionId,
        outline: { ...outline, id: 'formal-outline', title: 'forged topic' },
        allOutlines: [outline, outline, outline],
        userProfile: 'forged-profile',
        languageDirective: 'forged directive',
      }) as unknown as Parameters<typeof actionsPost>[0],
    );
    expect(actionsResponse.status).toBe(200);
    const actionOptions = mocks.generateSceneActions.mock.calls[0][3];
    expect(actionOptions.userProfile).toBeUndefined();
    expect(actionOptions.languageDirective).toBeUndefined();
    expect(mocks.generateSceneActions.mock.calls[0][0]).toMatchObject({
      title: 'Server-owned formal outline',
    });
    expect(actionOptions.ctx.totalPages).toBe(1);
  });

  it('keeps ordinary generation behaviour without either Fusion session', async () => {
    const { POST } = await import('@/app/api/generate/scene-actions/route');
    await POST(
      request({ userProfile: 'ordinary-profile' }) as unknown as Parameters<typeof POST>[0],
    );
    expect(mocks.generateSceneActions.mock.calls[0][3].userProfile).toBe('ordinary-profile');
  });

  it('rejects an invalid standalone Demo session without calling a model', async () => {
    const { POST } = await import('@/app/api/generate/scene-content/route');
    const response = await POST(
      request({ fusionSessionId: 'forged-session' }) as unknown as Parameters<typeof POST>[0],
    );

    expect(response.status).toBe(400);
    expect(mocks.resolveModelFromRequest).not.toHaveBeenCalled();
    expect(mocks.generateSceneContent).not.toHaveBeenCalled();
  });

  it('keeps server-owned checkpoint binding when assembling a scene', async () => {
    const { buildCompleteScene } = await import('@/lib/generation/scene-builder');
    const scene = buildCompleteScene(
      {
        ...outline,
        fusionCheckpoint: {
          checkpointId: 'checkpoint-point-1',
          mappingId: 'map-1',
          mappingRevision: '2',
          lessonKnowledgePointIds: ['point-1'],
          remediationStrategy: 'concrete_example',
        },
      },
      { elements: [] },
      [],
      'stage-1',
    );
    expect(scene?.fusionCheckpoint?.mappingId).toBe('map-1');
  });
});
