import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptySnapshot } from '@/lib/learner-memory/contracts';
import {
  assertPreclassContextCurrent,
  buildPreclassLearnerContext,
} from '@/lib/server/preclass-learner-context';

const database = vi.hoisted(() => ({
  query: vi.fn(),
  end: vi.fn(),
  pool: vi.fn(),
  transaction: vi.fn(),
  on: vi.fn(),
}));
vi.mock('pg', () => ({
  Pool: class {
    constructor(options: unknown) {
      database.pool(options);
    }
    query = database.query;
    end = database.end;
    on = database.on;
  },
}));
vi.mock('@openmaic/storage/server/reference', () => ({
  nodePostgresTransaction: (pool: unknown) => {
    database.transaction(pool);
    return async (body: (tx: { query: typeof database.query }) => Promise<unknown>) =>
      body({ query: database.query });
  },
}));

describe('preclass default formal Memory reader', () => {
  const previousUrl = process.env.MEMORY_DATABASE_URL;
  const previousAppUrl = process.env.DATABASE_URL;

  beforeEach(() => {
    vi.resetAllMocks();
    process.env.MEMORY_DATABASE_URL = 'postgresql://memory.invalid/simulation';
    process.env.DATABASE_URL = 'postgresql://application.invalid/production';
    const snapshot = emptySnapshot();
    database.query.mockImplementation(async (sql: string) => {
      if (sql.startsWith('SELECT learner_key')) return { rows: [{ learner_key: 'sim-a' }] };
      if (sql.startsWith('INSERT INTO learner_memory_states')) return { rows: [] };
      if (sql.startsWith('SELECT snapshot,maintenance'))
        return { rows: [{ snapshot, maintenance: false }] };
      if (sql.startsWith('SELECT source_id')) return { rows: [] };
      throw new Error('Unexpected SQL in read-only consumer');
    });
  });

  afterEach(() => {
    if (previousUrl === undefined) delete process.env.MEMORY_DATABASE_URL;
    else process.env.MEMORY_DATABASE_URL = previousUrl;
    if (previousAppUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousAppUrl;
  });

  it('uses a bounded dedicated pool and formal read for the selected identity, closing each connection', async () => {
    const select = vi.fn();
    const context = await buildPreclassLearnerContext(
      { student: 'A', task: 'task', content: {} },
      { select },
    );
    expect(context.status).toBe('empty');
    expect(database.pool).toHaveBeenCalledWith({
      connectionString: 'postgresql://memory.invalid/simulation',
      connectionTimeoutMillis: 5_000,
      query_timeout: 10_000,
      statement_timeout: 10_000,
      lock_timeout: 5_000,
      max: 1,
      options: '-c search_path=f67_simulated_memory',
    });
    expect(database.transaction).toHaveBeenCalledTimes(1);
    expect(database.on).toHaveBeenCalledWith('error', expect.any(Function));
    expect(database.query.mock.calls[0]).toEqual([
      'SELECT learner_key FROM learner_memory_states WHERE namespace=$1 AND learner_key=$2 FOR UPDATE',
      ['f67-test:simulated-memory-v1', 'sim-a'],
    ]);
    expect(
      database.query.mock.calls.some(([sql]) => sql.startsWith('SELECT snapshot,maintenance')),
    ).toBe(true);
    expect(database.query.mock.calls.some(([sql]) => sql.startsWith('SELECT source_id'))).toBe(
      true,
    );
    expect(database.query.mock.calls.every(([sql]) => !/CREATE|ALTER|DROP/.test(sql))).toBe(true);
    expect(database.end).toHaveBeenCalledTimes(1);
    expect(select).not.toHaveBeenCalled();
    await assertPreclassContextCurrent(context);
    expect(database.end).toHaveBeenCalledTimes(2);
  });

  it('requires the Memory connection and never falls back to the application database', async () => {
    delete process.env.MEMORY_DATABASE_URL;
    await expect(
      buildPreclassLearnerContext({ student: 'A', task: 'task', content: {} }, { select: vi.fn() }),
    ).rejects.toMatchObject({ code: 'LEARNER_MEMORY_UNAVAILABLE' });
    expect(database.pool).not.toHaveBeenCalled();
    expect(database.query).not.toHaveBeenCalled();
  });

  it('closes a pool on a read failure without reading seeds or initializing a schema', async () => {
    database.query.mockRejectedValue(new Error('query timeout'));
    const select = vi.fn();
    await expect(
      buildPreclassLearnerContext({ student: 'C', task: 'task', content: {} }, { select }),
    ).rejects.toThrow('query timeout');
    expect(database.end).toHaveBeenCalledTimes(1);
    expect(select).not.toHaveBeenCalled();
  });

  it('rejects a missing simulated state before the formal store can create an empty one', async () => {
    database.query.mockResolvedValue({ rows: [] });
    const select = vi.fn();
    await expect(
      buildPreclassLearnerContext({ student: 'C', task: 'task', content: {} }, { select }),
    ).rejects.toMatchObject({ code: 'LEARNER_MEMORY_UNAVAILABLE' });
    expect(database.query).toHaveBeenCalledTimes(1);
    expect(database.query.mock.calls[0][1]).toEqual(['f67-test:simulated-memory-v1', 'sim-c']);
    expect(database.end).toHaveBeenCalledTimes(1);
    expect(select).not.toHaveBeenCalled();
  });

  it('handles an idle pool error as a read failure and still closes', async () => {
    database.on.mockImplementation((_event: string, handler: (error: Error) => void) => {
      handler(new Error('idle connection lost'));
    });
    await expect(
      buildPreclassLearnerContext({ student: 'A', task: 'task', content: {} }, { select: vi.fn() }),
    ).rejects.toThrow('idle connection lost');
    expect(database.end).toHaveBeenCalledTimes(1);
  });
});
