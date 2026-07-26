import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/fusion/launch/route';
import { configureProductionFusionServices } from '@/lib/fusion/reliability/production-services';
const request = () =>
  new NextRequest('http://openmaic.local/api/fusion/launch', {
    method: 'POST',
    body: JSON.stringify({ classroomLaunchCode: 'code' }),
  });
describe('F16 launch route', () => {
  it('never returns delegation token', async () => {
    vi.stubEnv('DEEPTUTOR_FUSION_BASE_URL', 'http://dt.local');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url, init) => {
        const sessionId = JSON.parse(String(init?.body)).lessonSessionId;
        return new Response(
          JSON.stringify({
            token: 'secret',
            tokenId: 't',
            learnerId: 'learner-1',
            audience: 'openmaic',
            scope: [
              'profile:read',
              'diagnosis:request',
              'classroom-event:write',
              'profile-update:submit',
            ],
            expiresAt: 9999999999,
            lessonSessionId: sessionId,
          }),
          { status: 200 },
        );
      }),
    );
    const body = await (await POST(request())).json();
    expect(body.learnerId).toBe('learner-1');
    expect(JSON.stringify(body)).not.toContain('secret');
  });
  it('rejects invalid audience, scope, expiry or session binding', async () => {
    vi.stubEnv('DEEPTUTOR_FUSION_BASE_URL', 'http://dt.local');
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              token: 'secret',
              tokenId: 't',
              learnerId: 'learner-1',
              audience: 'wrong',
              scope: [],
              expiresAt: 0,
              lessonSessionId: 'wrong',
            }),
            { status: 200 },
          ),
      ),
    );
    expect((await POST(request())).status).toBe(401);
  });
});

describe('F19 production launch', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('persists only a credential reference and issues an HttpOnly session cookie', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('DEEPTUTOR_FUSION_BASE_URL', 'http://dt.local');
    vi.stubEnv('FUSION_POSTGRES_SECRET_REF', 'secret://postgres');
    vi.stubEnv('FUSION_SECRET_MANAGER_PROVIDER', 'platform');
    vi.stubEnv('FUSION_WORKLOAD_IDENTITY_PROVIDER', 'workload');
    vi.stubEnv('FUSION_CIRCUIT_FAILURE_THRESHOLD', '2');
    vi.stubEnv('FUSION_CIRCUIT_COOLDOWN_MS', '30000');
    const store = vi.fn(async () => 'secret://delegations/t');
    const create = vi.fn(async (_input: unknown) => undefined);
    configureProductionFusionServices({
      credentials: { store, delete: vi.fn() } as never,
      sessions: { create } as never,
      outbox: {} as never,
      circuits: {} as never,
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async (url, init) => {
          const value = String(url);
          if (value.includes('/profile?'))
            return new Response(JSON.stringify({ schemaVersion: 'v1', learnerId: 'learner-1' }), {
              status: 200,
            });
          if (value.includes('/knowledge-map?'))
            return new Response(
              JSON.stringify({ schemaVersion: 'v1', mappingId: 'map', mappingRevision: '1' }),
              { status: 200 },
            );
          return new Response(
            JSON.stringify({
              token: 'secret',
              tokenId: 't',
              learnerId: 'learner-1',
              audience: 'openmaic',
              scope: [
                'profile:read',
                'diagnosis:request',
                'classroom-event:write',
                'profile-update:submit',
              ],
              expiresAt: 9999999999,
              lessonSessionId: JSON.parse(String(init?.body)).lessonSessionId,
            }),
            { status: 200 },
          );
        },
      ),
    );
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(store).toHaveBeenCalledWith(expect.objectContaining({ token: 'secret' }));
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        credentialRef: 'secret://delegations/t',
        profileSnapshot: { schemaVersion: 'v1', learnerId: 'learner-1' },
        lessonKnowledgeMap: { schemaVersion: 'v1', mappingId: 'map', mappingRevision: '1' },
      }),
      expect.any(String),
    );
    expect(JSON.stringify(create.mock.calls[0]?.[0])).not.toContain('"token"');
    expect(response.headers.get('set-cookie')).toMatch(/HttpOnly/i);
    expect(JSON.stringify(await response.json())).not.toContain('secret');
  });
});
