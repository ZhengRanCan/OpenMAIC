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
}));

vi.mock('@/lib/ai/llm', () => ({ callLLM: mocks.callLLM }));
vi.mock('@/lib/server/resolve-model', () => ({
  resolveModelFromRequest: mocks.resolveModelFromRequest,
}));
vi.mock('@/lib/config/feature-flags', () => ({
  resolveVocationalActive: mocks.resolveVocationalActive,
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
  title: '一次函数的斜率',
  description: '解释斜率的意义。',
  keyPoints: ['斜率'],
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
      stageInfo: { name: '一次函数课堂' },
      languageDirective: '用中文授课。',
      ...extraBody,
    }),
    headers: { get: () => null },
  };
}

describe('F02 场景生成路由', () => {
  beforeEach(() => {
    vi.resetModules();
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.resolveModelFromRequest.mockResolvedValue({
      model: { id: 'language-model' },
      modelInfo: { outputWindow: 4096, capabilities: {} },
      modelString: 'test:model',
      thinkingConfig: undefined,
    });
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

  it('内容和动作路由都从同一 session id 解析同一份教学上下文', async () => {
    const fusionId = fusionSessionId();

    const { POST: contentPost } = await import('@/app/api/generate/scene-content/route');
    const contentResponse = await contentPost(
      request({ fusionSessionId: fusionId }) as unknown as Parameters<typeof contentPost>[0],
    );
    expect(contentResponse.status).toBe(200);
    const contentDirective = mocks.generateSceneContent.mock.calls[0][2]
      .languageDirective as string;

    vi.resetModules();
    const { POST: actionsPost } = await import('@/app/api/generate/scene-actions/route');
    const actionsResponse = await actionsPost(
      request({ fusionSessionId: fusionId }) as unknown as Parameters<typeof actionsPost>[0],
    );
    expect(actionsResponse.status).toBe(200);
    const actionsDirective = mocks.generateSceneActions.mock.calls[0][3]
      .languageDirective as string;

    expect(contentDirective).toBe(actionsDirective);
    expect(contentDirective).toContain('教学层级：foundation');
    expect(contentDirective).toContain('斜率与截距的现实含义');
    expect(contentDirective).not.toContain('demo-student-a');
  });

  it('keeps the formal checkpoint binding server-owned when assembling a scene', async () => {
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
    expect(scene?.fusionCheckpoint).toEqual({
      checkpointId: 'checkpoint-point-1',
      mappingId: 'map-1',
      mappingRevision: '2',
      lessonKnowledgePointIds: ['point-1'],
      remediationStrategy: 'concrete_example',
    });
  });

  it('未传 session id 时保留普通生成指令', async () => {
    const { POST: contentPost } = await import('@/app/api/generate/scene-content/route');
    await contentPost(request() as unknown as Parameters<typeof contentPost>[0]);
    expect(mocks.generateSceneContent.mock.calls[0][2].languageDirective).toBe('用中文授课。');

    vi.resetModules();
    const { POST: actionsPost } = await import('@/app/api/generate/scene-actions/route');
    await actionsPost(request() as unknown as Parameters<typeof actionsPost>[0]);
    expect(mocks.generateSceneActions.mock.calls[0][3].languageDirective).toBe('用中文授课。');
  });

  it('拒绝未知会话 id，且不会继续调用模型或生成器', async () => {
    const { POST: contentPost } = await import('@/app/api/generate/scene-content/route');
    const contentResponse = await contentPost(
      request({ fusionSessionId: 'forged-session' }) as unknown as Parameters<
        typeof contentPost
      >[0],
    );
    expect(contentResponse.status).toBe(400);
    expect(mocks.resolveModelFromRequest).not.toHaveBeenCalled();
    expect(mocks.generateSceneContent).not.toHaveBeenCalled();

    vi.resetModules();
    const { POST: actionsPost } = await import('@/app/api/generate/scene-actions/route');
    const actionsResponse = await actionsPost(
      request({ fusionSessionId: 'forged-session' }) as unknown as Parameters<
        typeof actionsPost
      >[0],
    );
    expect(actionsResponse.status).toBe(400);
    expect(mocks.generateSceneActions).not.toHaveBeenCalled();
  });
});
