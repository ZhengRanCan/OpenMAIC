import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
const m = vi.hoisted(() => ({ query: vi.fn(), read: vi.fn(), recover: vi.fn(), open: vi.fn() }));
vi.mock('@/lib/server/identity/with-owner', () => ({
  withRequestOwner: (req: Request, body: (p: unknown, h: Headers) => Promise<Response>) =>
    body({ ownerId: 'owner' }, new Headers()),
}));
vi.mock('@/lib/persistence/server-provider', () => ({
  getServerPersistenceProvider: async () => ({
    withTransaction: async (body: (tx: unknown) => Promise<unknown>) => body({ query: m.query }),
  }),
}));
vi.mock('@/lib/server/dialogue-learning-loop/config', () => ({
  readDialogueLoopConfig: () => ({
    sourceNature: 'synthetic',
    conditions: ['isolated'],
    memoryEnvironmentId: 'env',
  }),
}));
vi.mock('@/lib/server/dialogue-learning-loop/store', () => ({
  refreshLoopStageStatesIn: async (_tx: unknown, job: unknown) => job,
  DialogueLoopStore: class {
    read = m.read;
  },
}));
vi.mock('@/lib/server/dialogue-learning-loop/recovery', () => ({ recoverDialogueJob: m.recover }));
vi.mock('@/lib/server/dialogue-learning-loop/adapter', () => ({
  withDialogueLoopDeps: async (
    j: unknown,
    a: unknown,
    c: unknown,
    body: (d: unknown) => Promise<unknown>,
  ) => {
    m.open();
    return body({});
  },
}));
import { GET, POST } from '@/app/api/dialogue-learning-loop/[...path]/route';
const post = (body: unknown, origin = 'http://localhost') =>
  new NextRequest('http://localhost/api/dialogue-learning-loop/jobs/j/recover', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('OPENMAIC_AUTOMATIC_DIALOGUE_LOOP', 'true');
  m.query.mockImplementation(async (sql: string) => ({
    rows: sql.includes('stage_meta')
      ? [{ stage_id: 's' }]
      : [
          {
            data: {
              id: 'j',
              stageId: 's',
              chatSessionId: 'c',
              state: 'completed',
              reason: null,
              evidenceState: 'completed',
              memoryState: 'completed',
              blockingDeliveryId: null,
              snapshot: { contentDigest: 'digest', messages: ['PRIVATE'] },
              token: 'PRIVATE',
            },
          },
        ],
  }));
  m.read.mockResolvedValue({ id: 'j' });
  m.recover.mockResolvedValue({ id: 'j', state: 'queued' });
});
afterEach(() => vi.unstubAllEnvs());
it('is off by default and validates origin, size, paid flags and injected authority before opening Memory', async () => {
  vi.stubEnv('OPENMAIC_AUTOMATIC_DIALOGUE_LOOP', '');
  expect(
    (await GET(new NextRequest('http://localhost/api/dialogue-learning-loop/status'))).status,
  ).toBe(204);
  vi.stubEnv('OPENMAIC_AUTOMATIC_DIALOGUE_LOOP', 'true');
  expect(
    (await POST(post({ action: 'resume_saved', operationId: 'op' }, 'http://foreign'))).status,
  ).toBe(403);
  expect((await POST(post({ text: 'x'.repeat(17000) }))).status).toBe(413);
  expect((await POST(post({ action: 'retry_memory', operationId: 'op' }))).status).toBe(400);
  expect(
    (await POST(post({ action: 'resume_saved', operationId: 'op', student: 'B' }))).status,
  ).toBe(400);
  expect(m.open).not.toHaveBeenCalled();
});
it('projects no prompt, messages or internal tokens and uses the resolved owner', async () => {
  const r = await GET(
    new NextRequest('http://localhost/api/dialogue-learning-loop/status?stageId=s&chatSessionId=c'),
  );
  expect(r.headers.get('cache-control')).toBe('private, no-store');
  expect(await r.text()).not.toContain('PRIVATE');
  expect(m.query.mock.calls.some((c) => c[1]?.includes('owner'))).toBe(true);
  expect((await POST(post({ action: 'resume_saved', operationId: 'op' }))).status).toBe(200);
  expect(m.read).toHaveBeenCalledWith('owner', 'j');
});
