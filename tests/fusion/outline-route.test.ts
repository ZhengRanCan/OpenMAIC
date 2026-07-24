import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFusionDemoLessonSession } from '@/lib/fusion/session-catalog';

const streamLLMMock = vi.hoisted(() => vi.fn());
const resolveModelFromRequestMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/ai/llm', () => ({
  streamLLM: streamLLMMock,
}));

vi.mock('@/lib/server/resolve-model', () => ({
  resolveModelFromRequest: resolveModelFromRequestMock,
}));

function sessionId() {
  const result = createFusionDemoLessonSession('a', '请生成一次函数课堂');
  if (!result.ok) throw new Error('Expected demo session creation to succeed');
  return result.session.id;
}

function request(fusionSessionId?: string) {
  return {
    json: async () => ({
      requirements: { requirement: '请生成一次函数课堂' },
      pdfText: '',
      pdfImages: [],
      imageMapping: {},
      researchContext: '',
      fusionSessionId,
    }),
    headers: { get: () => null },
  };
}

async function drain(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) return;
  while (!(await reader.read()).done) {
    // 消费 SSE，确保 route 的异步生成任务完成。
  }
}

describe('F02 大纲路由', () => {
  beforeEach(() => {
    vi.resetModules();
    streamLLMMock.mockReset();
    resolveModelFromRequestMock.mockReset();
    resolveModelFromRequestMock.mockResolvedValue({
      model: { provider: 'test.chat', modelId: 'test-model' },
      modelInfo: { outputWindow: 4096, capabilities: {} },
      modelString: 'test:test-model',
      thinkingConfig: undefined,
    });
    streamLLMMock.mockReturnValue({
      textStream: (async function* () {
        yield JSON.stringify({
          languageDirective: '用中文授课。',
          courseTitle: '一次函数',
          outlines: [
            {
              id: 'scene_1',
              type: 'slide',
              title: '一次函数',
              description: '介绍一次函数。',
              keyPoints: ['斜率'],
              order: 1,
            },
          ],
        });
      })(),
    });
  });

  it('服务端根据同一个会话 id 注入冻结的 F01 教学上下文', async () => {
    const { POST } = await import('@/app/api/generate/scene-outlines-stream/route');
    const response = await POST(request(sessionId()) as unknown as Parameters<typeof POST>[0]);
    await drain(response);

    const prompt = streamLLMMock.mock.calls[0][0].prompt as string;
    expect(prompt).toContain('教学层级：foundation');
    expect(prompt).toContain('斜率与截距的现实含义');
    expect(prompt).not.toContain('demo-student-a');
    expect(prompt).not.toContain('演示学生 A');
  });

  it('未选择融合时保持原有大纲生成上下文', async () => {
    const { POST } = await import('@/app/api/generate/scene-outlines-stream/route');
    const response = await POST(request() as unknown as Parameters<typeof POST>[0]);
    await drain(response);

    const prompt = streamLLMMock.mock.calls[0][0].prompt as string;
    expect(prompt).not.toContain('## Fusion 教学上下文');
  });

  it('在调用模型前拒绝未知会话 id', async () => {
    const { POST } = await import('@/app/api/generate/scene-outlines-stream/route');
    const response = await POST(request('forged-session') as unknown as Parameters<typeof POST>[0]);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toMatchObject({ success: false, errorCode: 'INVALID_REQUEST' });
    expect(streamLLMMock).not.toHaveBeenCalled();
  });
});
