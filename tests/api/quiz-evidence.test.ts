import { beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const m = vi.hoisted(() => ({
  organize: vi.fn(),
  read: vi.fn(),
  operation: vi.fn(),
  restrict: vi.fn(),
  remove: vi.fn(),
  resolve: vi.fn(),
}));
vi.mock('@/lib/server/identity/with-owner', () => ({
  withRequestOwner: async (
    _r: Request,
    body: (p: { ownerId: string }, h: Headers) => Promise<Response>,
  ) => body({ ownerId: 'server-owner' }, new Headers({ 'set-cookie': 'test-owner=retained' })),
}));
vi.mock('@/lib/persistence/server-provider', () => ({
  getServerPersistenceProvider: async () => ({}),
}));
vi.mock('@/lib/server/quiz-evidence', () => ({ organizeQuizEvidence: m.organize }));
vi.mock('@/lib/persistence/quiz-evidence-read', () => ({
  readEvidenceRun: m.read,
  readEvidenceOperation: m.operation,
}));
vi.mock('@/lib/persistence/quiz-evidence-store', () => ({
  QuizEvidenceStore: class {
    restrict = m.restrict;
    delete = m.remove;
  },
}));
vi.mock('@/lib/server/resolve-model', () => ({ resolveModelFromRequest: m.resolve }));
import { GET, POST, DELETE } from '@/app/api/quiz-evidence/[...path]/route';
const body = {
  operationId: '82f3c7bf-35e0-4df8-9e01-d2b19543bcc7',
  stageId: 'stage',
  anchor: { attemptId: 'a', submissionId: 's' },
  related: [],
  language: 'zh-CN',
  action: 'reuse-or-create',
};
const req = (path: string, data: unknown = body, method = 'POST') =>
  new NextRequest('http://localhost/api/quiz-evidence/' + path, {
    method,
    headers: { 'content-type': 'application/json', origin: 'http://localhost' },
    body: JSON.stringify(data),
  });
beforeEach(() => {
  vi.stubEnv('OPENMAIC_EVIDENCE_ENABLED', 'true');
  Object.values(m).forEach((f) => f.mockReset());
});
it('defaults closed without touching storage or models', async () => {
  vi.stubEnv('OPENMAIC_EVIDENCE_ENABLED', '');
  expect((await POST(req('runs'))).status).toBe(404);
  expect(m.organize).not.toHaveBeenCalled();
});
it('uses server owner, preserves headers, and defers model resolution', async () => {
  m.organize.mockResolvedValue({
    status: 201,
    run: { id: 'r', semanticStatus: 'unreviewed', adoptionAllowed: false },
  });
  const res = await POST(req('runs'));
  expect(res.status).toBe(201);
  expect(res.headers.get('set-cookie')).toContain('retained');
  expect(res.headers.get('cache-control')).toContain('no-store');
  expect(m.organize.mock.calls[0][1].ownerId).toBe('server-owner');
  expect(m.resolve).not.toHaveBeenCalled();
});
it('refuses owner and raw source injection', async () => {
  expect((await POST(req('runs', { ...body, ownerId: 'foreign' }))).status).toBe(400);
  expect(m.organize).not.toHaveBeenCalled();
});
it('rejects cross origin writes', async () => {
  const r = req('runs');
  r.headers.set('origin', 'http://foreign.invalid');
  expect((await POST(r)).status).toBe(403);
  expect(m.organize).not.toHaveBeenCalled();
});
it('rejects oversized UTF8 bodies before dispatch', async () => {
  expect((await POST(req('runs', { ...body, padding: '中'.repeat(6000) }))).status).toBe(413);
  expect(m.organize).not.toHaveBeenCalled();
});
it('GET uses the protected view and never resolves a model', async () => {
  m.read.mockResolvedValue({ runId: 'r', visibility: 'source-unavailable' });
  const res = await GET(new NextRequest('http://localhost/api/quiz-evidence/runs/r'));
  expect(await res.json()).toEqual({ runId: 'r', visibility: 'source-unavailable' });
  expect(m.read).toHaveBeenCalledWith({}, 'server-owner', 'r');
  expect(m.resolve).not.toHaveBeenCalled();
  expect(m.organize).not.toHaveBeenCalled();
});
it('DELETE hides absence and returns 204', async () => {
  expect((await DELETE(req('runs/r', {}, 'DELETE'))).status).toBe(204);
  expect(m.remove).toHaveBeenCalledWith('server-owner', 'r');
});
it('never reflects unexpected exception text', async () => {
  m.read.mockRejectedValue(new Error('private answer and secret'));
  const res = await GET(new NextRequest('http://localhost/api/quiz-evidence/runs/r'));
  expect(res.status).toBe(503);
  expect(await res.text()).not.toContain('private answer');
  expect(res.headers.get('set-cookie')).toContain('retained');
});
