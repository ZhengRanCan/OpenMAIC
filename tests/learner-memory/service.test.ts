import { describe, expect, it, vi } from 'vitest';
import { memoryFixture } from '../persistence/learner-memory-fixture';
import { updateMemory } from '@/lib/server/learner-memory';
import { response } from './fixtures';

describe('Memory invocation lifecycle', () => {
  it('does not call for no-op or a previously committed run', async () => {
    const f = await memoryFixture();
    try {
      const invoke = vi.fn();
      await f.store.prepare(f.scope, 'empty');
      expect((await updateMemory(f.store, f.scope, 'empty', invoke)).state).toBe('noop');
      await f.adopt();
      await updateMemory(f.store, f.scope, 'op', invoke);
      expect(invoke).not.toHaveBeenCalled();
    } finally {
      await f.close();
    }
  });
  it('claims once and never retries a model exception', async () => {
    const f = await memoryFixture();
    try {
      await f.store.ingest(f.scope, [f.input]);
      await f.store.prepare(f.scope, 'call');
      const invoke = vi.fn().mockRejectedValue(new Error('sensitive provider exception'));
      expect((await updateMemory(f.store, f.scope, 'call', invoke)).state).toBe('failed');
      const retry = await updateMemory(f.store, f.scope, 'call', invoke);
      expect(invoke).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(retry)).not.toContain('sensitive provider');
    } finally {
      await f.close();
    }
  });
  it('recovers captured output after commit failure without another paid call', async () => {
    const f = await memoryFixture();
    try {
      await f.store.ingest(f.scope, [f.input]);
      await f.store.prepare(f.scope, 'recover');
      const invoke = vi.fn().mockResolvedValue({
        text: JSON.stringify(response()),
        finishReason: 'stop',
        model: 'test',
        origin: 'model',
        usage: null,
      });
      f.injectCommitFailure(true);
      await expect(updateMemory(f.store, f.scope, 'recover', invoke)).rejects.toThrow('injected');
      f.injectCommitFailure(false);
      expect((await updateMemory(f.store, f.scope, 'recover', invoke)).state).toBe('completed');
      expect(invoke).toHaveBeenCalledTimes(1);
    } finally {
      await f.close();
    }
  });
});
