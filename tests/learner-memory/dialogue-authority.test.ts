import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { memoryFixture } from '../persistence/learner-memory-fixture';
import { LearnerMemoryStore } from '@/lib/persistence/learner-memory-store';
import { adaptDialogueMemorySources } from '@/lib/learner-memory/dialogue-source';
import { response } from './fixtures';

const input = () =>
  adaptDialogueMemorySources(
    JSON.parse(readFileSync('../docs/log/artifacts/F73/live-001/D01.result.json', 'utf8')),
  )[1].source;
describe('shared Memory Dialogue authority', () => {
  it('fails closed without authority and checks new Dialogue before ingest', async () => {
    const f = await memoryFixture();
    try {
      await expect(f.store.ingest(f.scope, [input()])).rejects.toMatchObject({
        code: 'DIALOGUE_SOURCE_AUTHORITY_REQUIRED',
      });
    } finally {
      await f.close();
    }
  });
  it('restricts withdrawn support on formal read while preserving unrelated content', async () => {
    const f = await memoryFixture();
    let withdrawn = false;
    const store = new LearnerMemoryStore({
      ...f.store.provider,
      sourceAuthority: async () => (withdrawn ? 'source_deleted' : null),
    });
    try {
      await store.ingest(f.scope, [input()]);
      await store.prepare(f.scope, 'dialogue');
      await store.capture(f.scope, 'dialogue', {
        text: JSON.stringify(response()),
        finishReason: 'stop',
        model: 'control',
        origin: 'manual',
        usage: null,
      });
      expect((await store.commit(f.scope, 'dialogue')).state).toBe('completed');
      expect((await store.read(f.scope)).usable.pieces).toHaveLength(1);
      withdrawn = true;
      const view = await store.read(f.scope);
      expect(view.usable.pieces).toHaveLength(0);
      expect(view.maintenancePending).toBe(true);
      expect(view.snapshot.pieces).toHaveLength(1);
      expect(view.coverage[0].valid).toBe(false);
      await expect(store.ingest(f.scope, [input()])).rejects.toMatchObject({
        code: 'DIALOGUE_SOURCE_RESTRICTED',
      });
    } finally {
      await f.close();
    }
  });
  it('does not disguise an unavailable authority as deletion', async () => {
    const f = await memoryFixture();
    let unavailable = false;
    const store = new LearnerMemoryStore({
      ...f.store.provider,
      sourceAuthority: async () => {
        if (unavailable) throw Error('app unavailable');
        return null;
      },
    });
    try {
      await store.ingest(f.scope, [input()]);
      unavailable = true;
      await expect(store.read(f.scope)).rejects.toThrow('app unavailable');
      unavailable = false;
      expect((await store.read(f.scope)).coverage[0].valid).toBe(true);
    } finally {
      await f.close();
    }
  });
});
