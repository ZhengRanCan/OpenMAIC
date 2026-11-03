import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const mocks = vi.hoisted(() => ({
  prepare: vi.fn(),
  claim: vi.fn(),
  read: vi.fn(),
  recover: vi.fn(),
  remove: vi.fn(),
  owner: 'owner',
  resolve: vi.fn(),
}));
vi.mock('@/lib/server/identity/with-owner', () => ({
  withRequestOwner: (
    _req: unknown,
    fn: (principal: { ownerId: string }, headers: Headers) => Promise<Response>,
  ) => fn({ ownerId: mocks.owner }, new Headers()),
}));
vi.mock('@/lib/persistence/server-provider', () => ({
  getServerPersistenceProvider: async () => ({}),
}));
vi.mock('@/lib/persistence/dialogue-evidence-store', () => ({
  DialogueEvidenceStore: class {
    prepare = mocks.prepare;
    claim = mocks.claim;
    recover = mocks.recover;
    delete = mocks.remove;
  },
}));
vi.mock('@/lib/persistence/dialogue-evidence-read', () => ({
  readDialogueEvidenceRun: mocks.read,
}));
vi.mock('@/lib/server/resolve-model', () => ({ resolveModelFromRequest: mocks.resolve }));
vi.mock('@/lib/server/dialogue-evidence-provenance', () => ({
  loadDialogueEvidenceSettings: async () => ({ bindings: [], memoryEnvironmentId: '' }),
}));
import { POST, GET } from '@/app/api/dialogue-evidence/[...path]/route';
function req(
  path = 'runs',
  body: unknown = { operationId: 'op', stageId: 'stage', chatSessionId: 'chat' },
  extra = {},
) {
  return new NextRequest('http://localhost/api/dialogue-evidence/' + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost', ...extra },
    body: JSON.stringify(body),
  });
}
describe('Dialogue controlled HTTP', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.OPENMAIC_DIALOGUE_EVIDENCE_ENABLED = 'true';
    mocks.resolve.mockResolvedValue({ providerId: 'test', modelId: 'test' });
    mocks.prepare.mockResolvedValue({ id: 'run', state: 'prepared' });
    mocks.read.mockResolvedValue({ id: 'run', state: 'prepared' });
  });
  it('is disabled by default', async () => {
    delete process.env.OPENMAIC_DIALOGUE_EVIDENCE_ENABLED;
    expect((await POST(req())).status).toBe(404);
    expect(mocks.prepare).not.toHaveBeenCalled();
  });
  it('allows only source locators and uses the resolved owner', async () => {
    expect((await POST(req())).status).toBe(201);
    expect(mocks.prepare.mock.calls[0][0]).toBe('owner');
    for (const extra of [{ student: 'A' }, { messages: [] }, { ownerId: 'foreign' }])
      expect(
        (
          await POST(
            req('runs', { operationId: 'op', stageId: 'stage', chatSessionId: 'chat', ...extra }),
          )
        ).status,
      ).toBe(400);
  });
  it('rejects cross-origin and oversized requests before prepare or model resolution', async () => {
    expect((await POST(req('runs', {}, { origin: 'http://foreign' }))).status).toBe(403);
    expect((await POST(req('runs', { value: 'x'.repeat(17000) }))).status).toBe(413);
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(mocks.resolve).not.toHaveBeenCalled();
  });
  it('enforces explicit paid retry confirmation and returns owner-scoped state without caching', async () => {
    expect(
      (await POST(req('runs/run/recover', { action: 'confirm_paid_retry', operationId: 'op' })))
        .status,
    ).toBe(400);
    const response = await GET(new NextRequest('http://localhost/api/dialogue-evidence/runs/run'));
    expect(mocks.read.mock.calls[0].slice(1)).toEqual(['owner', 'run']);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });
});
