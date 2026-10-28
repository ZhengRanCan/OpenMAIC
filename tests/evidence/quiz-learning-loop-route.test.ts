import { describe, expect, it, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  retryEvidence: vi.fn(),
  retryMemory: vi.fn(),
  openMemory: vi.fn(),
  config: vi.fn(),
}));
vi.mock('@/lib/server/identity/with-owner', () => ({
  withRequestOwner: async (
    _req: Request,
    fn: (principal: { ownerId: string }, headers: Headers) => Promise<Response>,
  ) => fn({ ownerId: 'owner-a' }, new Headers()),
}));
vi.mock('@/lib/persistence/server-provider', () => ({
  getServerPersistenceProvider: async () => ({
    pool: { query: mocks.query },
    withTransaction: vi.fn(),
  }),
}));
vi.mock('@/lib/server/quiz-learning-loop/retry-evidence', () => ({
  retryEvidence: mocks.retryEvidence,
}));
vi.mock('@/lib/server/quiz-learning-loop/retry-memory', () => ({ retryMemory: mocks.retryMemory }));
vi.mock('@/lib/server/simulated-memory', () => ({ openSimulatedMemory: mocks.openMemory }));
vi.mock('@/lib/server/quiz-learning-loop/config', () => ({
  readSimulatedLearningLoopConfig: mocks.config,
}));

import { GET, POST } from '@/app/api/quiz-learning-loop/[attemptId]/route';
const params = { params: Promise.resolve({ attemptId: 'attempt-a' }) };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.config.mockReturnValue({ enabled: true });
});
describe('learning loop status and recovery', () => {
  it('leaves ordinary Quiz pages unchanged when simulation is disabled', async () => {
    mocks.config.mockReturnValue(null);
    const response = await GET(
      new Request('http://localhost/api/quiz-learning-loop/attempt-a'),
      params,
    );
    expect(response.status).toBe(204);
    expect(mocks.query).not.toHaveBeenCalled();
  });
  it('does not show a waiting state for an unrelated attempt', async () => {
    mocks.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ eligible: false }] });
    const response = await GET(
      new Request('http://localhost/api/quiz-learning-loop/attempt-a'),
      params,
    );
    expect(response.status).toBe(204);
    expect(mocks.query.mock.calls[1][1]).toEqual(['owner-a', 'attempt-a']);
  });
  it('limits status to the resolved owner and does not return the source payload', async () => {
    mocks.query.mockResolvedValue({
      rows: [{ state: 'unknown', error_code: 'EVIDENCE_CALL_UNKNOWN', evidence_run_id: 'e1' }],
    });
    const response = await GET(
      new Request('http://localhost/api/quiz-learning-loop/attempt-a'),
      params,
    );
    expect(response.status).toBe(200);
    expect(mocks.query.mock.calls[0][1]).toEqual(['owner-a', 'attempt-a']);
    expect(await response.json()).toEqual({
      job: { state: 'unknown', error_code: 'EVIDENCE_CALL_UNKNOWN', evidence_run_id: 'e1' },
    });
  });
  it('refuses cross-origin recovery before touching the database', async () => {
    const response = await POST(
      new Request('http://localhost/api/quiz-learning-loop/attempt-a', {
        method: 'POST',
        headers: { origin: 'http://evil.example', 'content-type': 'application/json' },
        body: '{"action":"retry"}',
      }),
      params,
    );
    expect(response.status).toBe(403);
    expect(mocks.query).not.toHaveBeenCalled();
  });
  it('passes explicit confirmation and owner to Evidence recovery', async () => {
    mocks.query.mockResolvedValue({ rows: [] });
    mocks.retryEvidence.mockResolvedValue(true);
    const response = await POST(
      new Request('http://localhost/api/quiz-learning-loop/attempt-a', {
        method: 'POST',
        headers: { origin: 'http://localhost', 'content-type': 'application/json' },
        body: '{"action":"retry","confirmUnknown":true}',
      }),
      params,
    );
    expect(response.status).toBe(200);
    expect(mocks.retryEvidence.mock.calls[0].slice(2)).toEqual(['owner-a', 'attempt-a', true]);
    expect(mocks.openMemory).not.toHaveBeenCalled();
  });
});
