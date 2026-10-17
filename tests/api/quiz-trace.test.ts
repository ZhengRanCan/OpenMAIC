import { it, expect, vi, beforeEach } from 'vitest';
const mocks = vi.hoisted(() => ({ prepare: vi.fn(), history: vi.fn() }));
vi.mock('@/lib/server/identity/with-owner', () => ({
  withRequestOwner: async (
    _req: Request,
    body: (p: { ownerId: string }, h: Headers) => Promise<Response>,
  ) => body({ ownerId: 'server-owner' }, new Headers()),
}));
vi.mock('@/lib/persistence/server-provider', () => ({
  getServerPersistenceProvider: async () => ({}),
}));
vi.mock('@/lib/persistence/quiz-trace', () => ({
  QuizTraceService: class {
    prepare = mocks.prepare;
  },
}));
vi.mock('@/lib/persistence/quiz-trace-read', () => ({ readQuizHistory: mocks.history }));
import { GET, POST } from '@/app/api/quiz-trace/[...path]/route';
beforeEach(() => {
  mocks.prepare.mockReset();
  mocks.history.mockReset();
});
it('derives owner server-side and ignores a body owner claim', async () => {
  mocks.prepare.mockResolvedValue({ attemptId: 'a' });
  const req = new Request('http://localhost/api/quiz-trace/prepare', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ownerId: 'foreign' }),
  });
  expect((await POST(req)).status).toBe(200);
  expect(mocks.prepare).toHaveBeenCalledWith('server-owner', { ownerId: 'foreign' });
});
it('history is no-store and invokes no prepare write', async () => {
  mocks.history.mockResolvedValue({ attempts: [] });
  const res = await GET(new Request('http://localhost/api/quiz-trace/history?stageId=stage'));
  expect(res.headers.get('cache-control')).toContain('no-store');
  expect(mocks.prepare).not.toHaveBeenCalled();
  expect(mocks.history).toHaveBeenCalledWith({}, 'server-owner', 'stage');
});
it('refuses cross-origin mutation before service invocation', async () => {
  const req = new Request('http://localhost/api/quiz-trace/prepare', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://attacker.invalid' },
    body: '{}',
  });
  expect((await POST(req)).status).toBe(403);
  expect(mocks.prepare).not.toHaveBeenCalled();
});
