import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { SceneOutline } from '@/lib/types/generation';

const mocks = vi.hoisted(() => ({
  getCurrentModelConfig: vi.fn(),
  settingsState: vi.fn(),
  audioPut: vi.fn(),
  isTTSProviderEnabled: vi.fn(),
  pickNarratorAgent: vi.fn(),
  resolveAgentVoiceOptions: vi.fn(),
  listAgents: vi.fn(),
}));

vi.mock('@/lib/utils/model-config', () => ({
  getCurrentModelConfig: mocks.getCurrentModelConfig,
}));
vi.mock('@/lib/store/settings', () => ({
  useSettingsStore: { getState: mocks.settingsState },
}));
vi.mock('@/lib/utils/database', () => ({
  db: { audioFiles: { put: mocks.audioPut } },
}));
vi.mock('@/lib/audio/provider-enablement', () => ({
  isTTSProviderEnabled: mocks.isTTSProviderEnabled,
}));
vi.mock('@/lib/audio/agent-voice', () => ({
  pickNarratorAgent: mocks.pickNarratorAgent,
  resolveAgentVoiceOptions: mocks.resolveAgentVoiceOptions,
}));
vi.mock('@/lib/orchestration/registry/store', () => ({
  useAgentRegistry: { getState: () => ({ listAgents: mocks.listAgents }) },
}));

const mockFetch = vi.fn() as Mock;
vi.stubGlobal('fetch', mockFetch);

const outline: SceneOutline = {
  id: 'outline-1',
  type: 'slide',
  title: '一次函数的斜率',
  description: '解释斜率的意义。',
  keyPoints: ['斜率'],
  order: 1,
};

function jsonResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => body,
  };
}

describe('正式 Fusion 客户端会话传递', () => {
  beforeEach(() => {
    vi.resetModules();
    mockFetch.mockReset();
    mocks.getCurrentModelConfig.mockReturnValue({});
    mocks.settingsState.mockReturnValue({
      imageProviderId: '',
      imageProvidersConfig: {},
      imageGenerationEnabled: false,
      videoProviderId: '',
      videoProvidersConfig: {},
      videoGenerationEnabled: false,
      ttsProviderId: 'server-tts',
      ttsProvidersConfig: {},
    });
    mocks.isTTSProviderEnabled.mockReturnValue(false);
    mocks.pickNarratorAgent.mockReturnValue(undefined);
    mocks.resolveAgentVoiceOptions.mockResolvedValue({});
    mocks.listAgents.mockReturnValue([]);
  });

  it('formal session id follows content and action requests without profile data', async () => {
    const lessonSessionId = 'formal-session-opaque-id';
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ success: true, content: { elements: [] } }))
      .mockResolvedValueOnce(jsonResponse({ success: true, scene: { id: 'scene-1' } }));

    const { fetchSceneActions, fetchSceneContent } =
      await import('@/lib/hooks/use-scene-generator');
    await fetchSceneContent(
      {
        outline,
        allOutlines: [outline],
        stageId: 'stage-1',
        stageInfo: { name: '一次函数课堂' },
        lessonSessionId,
      },
      undefined,
      { maxRetries: 0 },
    );
    await fetchSceneActions(
      {
        outline,
        allOutlines: [outline],
        content: { elements: [] },
        stageId: 'stage-1',
        lessonSessionId,
      },
      undefined,
      { maxRetries: 0 },
    );

    const contentBody = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    const actionsBody = JSON.parse(mockFetch.mock.calls[1][1].body as string);
    expect(contentBody.lessonSessionId).toBe(lessonSessionId);
    expect(actionsBody.lessonSessionId).toBe(lessonSessionId);
    expect(JSON.stringify([contentBody, actionsBody])).not.toContain('profileSnapshot');
    expect(JSON.stringify([contentBody, actionsBody])).not.toContain('delegationToken');
  });
});
