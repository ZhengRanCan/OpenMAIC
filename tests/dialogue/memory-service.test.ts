import { describe, expect, it, vi } from 'vitest';
import { runFixture } from '../learner-memory/fixtures';
import type { ResolvedModel } from '@/lib/server/resolve-model';
const calls = vi.hoisted(() => ({ llm: vi.fn() }));
vi.mock('@/lib/ai/llm', () => ({ callLLM: calls.llm }));
import {
  dialogueMemoryModelIdentity,
  invokeDialogueMemoryModel,
} from '@/lib/server/dialogue-memory-model';
describe('Dialogue Memory model boundary', () => {
  it('freezes public identity without credentials and makes a no-retry no-fallback call', async () => {
    const model = {
      providerId: 'synthetic',
      modelId: 'model',
      modelString: 'synthetic:model',
      apiKey: 'private-key',
      baseUrl: 'https://private-endpoint',
      model: {},
      serverManaged: true,
      modelInfo: { contextWindow: 128000, outputWindow: 8192 },
    } as unknown as ResolvedModel;
    const identity = dialogueMemoryModelIdentity(model);
    expect(JSON.stringify(identity)).not.toContain('private');
    expect(identity).toMatchObject({
      slot: 'classroom',
      maxOutputTokens: 8192,
      timeoutMs: 180000,
      promptVersion: 'dialogue-memory.v1',
    });
    calls.llm.mockResolvedValue({
      text: '{}',
      finishReason: 'stop',
      usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
      response: { modelId: 'actual' },
    });
    const reply = await invokeDialogueMemoryModel(model, runFixture());
    expect(calls.llm).toHaveBeenCalledTimes(1);
    expect(calls.llm.mock.calls[0][0]).toMatchObject({ maxOutputTokens: 8192, maxRetries: 0 });
    expect(calls.llm.mock.calls[0][2]).toEqual({ retries: 0 });
    expect(calls.llm.mock.calls[0][4]).toMatchObject({ enabled: false });
    expect(reply).toMatchObject({ model: 'actual', origin: 'model', usage: { totalTokens: 3 } });
  });
});
