import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { runFixture } from '../learner-memory/fixtures';
const m = vi.hoisted(() => ({
  prepare: vi.fn(),
  read: vi.fn(),
  update: vi.fn(),
  recover: vi.fn(),
  close: vi.fn(),
}));
vi.mock('@/lib/server/identity/with-owner', () => ({
  withRequestOwner: (_r: unknown, fn: (p: { ownerId: string }, h: Headers) => Promise<Response>) =>
    fn({ ownerId: 'owner' }, new Headers()),
}));
vi.mock('@/lib/persistence/server-provider', () => ({
  getServerPersistenceProvider: async () => ({
    withTransaction: async (fn: (tx: unknown) => unknown) => fn({}),
  }),
}));
vi.mock('@/lib/server/dialogue-memory-authority', () => ({
  verifiedDialogueEvidenceIn: async () => ({}),
  loadDialogueMemorySettings: async () => ({ bindings: [], memoryEnvironmentId: '' }),
}));
vi.mock('@/lib/persistence/dialogue-memory-store', () => ({
  DialogueMemoryStore: class {
    read = m.read;
  },
}));
vi.mock('@/lib/server/simulated-memory', () => ({
  openSimulatedMemory: async () => ({ memory: { provider: {} }, close: m.close }),
}));
vi.mock('@/lib/server/resolve-model', () => ({
  resolveModelFromRequest: async () => ({ providerId: 'synthetic', modelId: 'test' }),
}));
vi.mock('@/lib/server/dialogue-memory', () => ({
  DialogueMemoryService: class {
    prepare = m.prepare;
    read = m.read;
    update = m.update;
    recover = m.recover;
  },
}));
import { POST, GET } from '@/app/api/dialogue-memory/[...path]/route';
const req = (body: unknown, path = 'deliveries', origin = 'http://localhost') =>
  new NextRequest('http://localhost/api/dialogue-memory/' + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify(body),
  });
describe('Dialogue Memory owner HTTP', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.OPENMAIC_DIALOGUE_MEMORY_ENABLED = 'true';
    m.prepare.mockResolvedValue({ delivery: { id: 'delivery', state: 'prepared' } });
    m.read.mockResolvedValue({ id: 'delivery', state: 'completed', delivery: { id: 'delivery' } });
  });
  it('is explicitly disabled and rejects injected student, facts and scope', async () => {
    delete process.env.OPENMAIC_DIALOGUE_MEMORY_ENABLED;
    expect((await POST(req({}))).status).toBe(404);
    process.env.OPENMAIC_DIALOGUE_MEMORY_ENABLED = 'true';
    for (const extra of [{ student: 'B' }, { facts: [] }, { scope: { learnerKey: 'foreign' } }])
      expect((await POST(req({ operationId: 'op', evidenceRunId: 'run', ...extra }))).status).toBe(
        400,
      );
    expect(m.prepare).not.toHaveBeenCalled();
  });
  it('prepares for resolved owner, refuses cross-origin and oversized body', async () => {
    expect((await POST(req({ operationId: 'op', evidenceRunId: 'run' }))).status).toBe(201);
    expect(m.prepare.mock.calls[0][0]).toBe('owner');
    expect(m.close).toHaveBeenCalled();
    expect((await POST(req({}, 'deliveries', 'http://foreign'))).status).toBe(403);
    expect((await POST(req({ text: 'x'.repeat(17000) }))).status).toBe(413);
  });
  it('requires paid retry acknowledgement and no-store for read', async () => {
    expect(
      (await POST(req({ action: 'confirm_paid_retry', operationId: 'op' }, 'deliveries/d/recover')))
        .status,
    ).toBe(400);
    const r = await GET(new NextRequest('http://localhost/api/dialogue-memory/deliveries/d'));
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe('private, no-store');
  });
  it('rejects insufficient model capacity before claiming or invoking Memory', async () => {
    m.read.mockResolvedValue({
      id: 'delivery',
      delivery: { id: 'delivery', state: 'prepared' },
      memoryRun: { ...runFixture(), prompt: { ...runFixture().prompt, inputBytes: 200000 } },
    });
    const r = await POST(req({}, 'deliveries/d/update'));
    expect(r.status).toBe(409);
    expect((await r.json()).error.code).toBe('MODEL_CONTEXT_CAPACITY');
    expect(m.update).not.toHaveBeenCalled();
  });
});
