import { describe, expect, it, vi } from 'vitest';
import type { Queryable } from '@openmaic/storage/document/pg';
import { readDialogueSource } from '@/lib/persistence/dialogue-trace-read';
import { DialogueTraceReadError } from '@/lib/dialogue/trace-types';

describe('dialogue source read boundary', () => {
  it('runs only transaction configuration and owner-scoped SELECTs, without bootstrapping', async () => {
    const query = vi.fn(async (sql: string) => ({
      rows: sql.includes('FROM stage_meta') ? [{ stage_id: 's', deleted_at: null }] : [],
    }));
    const provider = {
      withTransaction: async <T>(body: (q: Queryable) => Promise<T>) =>
        body({ query } as Queryable),
    };
    expect(
      await readDialogueSource(provider, 'owner', { stageId: 's', chatSessionId: 'c' }),
    ).toEqual({ status: 'missing' });
    expect(query.mock.calls[0][0]).toContain('REPEATABLE READ, READ ONLY');
    for (const [sql] of query.mock.calls) expect(sql).toMatch(/^(SET TRANSACTION|SELECT)/);
    expect(
      query.mock.calls
        .slice(1)
        .every((call) => call[0].includes('owner_id=$2') || call[0].includes('learner_key=$2')),
    ).toBe(true);
  });
  it('does not reveal cross-owner records or return database failure as empty', async () => {
    const empty: Pick<Queryable, 'query'> = { query: async () => ({ rows: [] }) };
    expect(
      await readDialogueSource({ withTransaction: (body) => body(empty) }, 'other', {
        stageId: 's',
        chatSessionId: 'c',
      }),
    ).toEqual({ status: 'missing' });
    await expect(
      readDialogueSource(
        {
          withTransaction: async () => {
            throw Error('offline');
          },
        },
        'owner',
        { stageId: 's', chatSessionId: 'c' },
      ),
    ).rejects.toBeInstanceOf(DialogueTraceReadError);
  });
});
