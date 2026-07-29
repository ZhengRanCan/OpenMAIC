import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET as getConnection } from '@/app/api/fusion/connection/route';
import { POST as createDevelopmentLaunch } from '@/app/api/fusion/dev-launch/route';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('F24 formal Fusion connection route', () => {
  it('reports a compatible server without exposing its configured address', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('FUSION_DEVELOPMENT_UI_ENABLED', 'true');
    vi.stubEnv('DEEPTUTOR_FUSION_BASE_URL', 'http://deeptutor.internal');
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              paths: {
                '/api/v1/fusion/launch-codes': {},
                '/api/v1/fusion/launch/exchange': {},
                '/api/v1/fusion/profile': {},
                '/api/v1/fusion/knowledge-map': {},
              },
            }),
          ),
      ),
    );

    const response = await getConnection();
    const body = await response.json();
    expect(body).toEqual({
      success: true,
      configured: true,
      reachable: true,
      developmentUiEnabled: true,
    });
    expect(JSON.stringify(body)).not.toContain('deeptutor.internal');
  });

  it('does not enable the local entry when the explicit switch is absent', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('DEEPTUTOR_FUSION_BASE_URL', 'http://deeptutor.internal');
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              paths: {
                '/api/v1/fusion/launch-codes': {},
                '/api/v1/fusion/launch/exchange': {},
                '/api/v1/fusion/profile': {},
                '/api/v1/fusion/knowledge-map': {},
              },
            }),
          ),
      ),
    );

    expect(await (await getConnection()).json()).toMatchObject({
      reachable: true,
      developmentUiEnabled: false,
    });
  });
});

describe('F24 development launch bridge', () => {
  it('allows the one-time launch code only under the explicit local switch', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('FUSION_DEVELOPMENT_UI_ENABLED', 'true');
    vi.stubEnv('DEEPTUTOR_FUSION_BASE_URL', 'http://deeptutor.internal');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ classroomLaunchCode: 'one-time-code' }))),
    );

    const response = await createDevelopmentLaunch();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, classroomLaunchCode: 'one-time-code' });
  });

  it('rejects a production or unconfigured local UI before calling DeepTutor', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('FUSION_DEVELOPMENT_UI_ENABLED', 'true');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await createDevelopmentLaunch();
    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
