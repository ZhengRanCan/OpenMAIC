import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { read, generate, provider } = vi.hoisted(() => ({
  read: vi.fn(),
  generate: vi.fn(),
  provider: vi.fn(),
}));
vi.mock('@/lib/server/identity/with-owner', () => ({
  withRequestOwner: (
    _request: unknown,
    run: (principal: { ownerId: string }, headers: Headers) => Promise<Response>,
  ) => run({ ownerId: 'trusted-owner' }, new Headers()),
}));
vi.mock('@/lib/persistence/server-provider', () => ({ getServerPersistenceProvider: provider }));
vi.mock('@/lib/server/quiz-feedback', () => ({
  QuizFeedbackService: class {
    read = read;
    generate = generate;
  },
}));

import { GET, POST } from '@/app/api/quiz-feedback/route';

const url = 'http://localhost/api/quiz-feedback';
const locator = {
  attemptId: 'attempt',
  versionId: 'version',
  submissionId: 'submission',
  reviewId: 'review',
};
const environment = '00000000-0000-4000-8000-000000000085';
function post(body: Record<string, unknown>, site = 'same-origin') {
  return POST(
    new NextRequest(url, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json', 'sec-fetch-site': site },
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('OPENMAIC_QUIZ_FEEDBACK', 'true');
  vi.stubEnv(
    'OPENMAIC_SIMULATED_LEARNING_LOOP',
    JSON.stringify({
      sourceNature: 'synthetic',
      conditions: ['synthetic'],
      memoryEnvironmentId: environment,
    }),
  );
});
afterEach(() => vi.unstubAllEnvs());

it('reads current feedback without generating', async () => {
  read.mockResolvedValue({ status: 'idle' });
  const res = await GET(new NextRequest(`${url}?${new URLSearchParams(locator)}`));
  expect(res.headers.get('cache-control')).toBe('private, no-store');
  expect(await res.json()).toEqual({ status: 'idle' });
  expect(read).toHaveBeenCalledWith({
    owner: 'trusted-owner',
    locator,
    language: 'en-US',
    environment,
  });
  expect(generate).not.toHaveBeenCalled();
});

it('rejects cross-site and client-supplied feedback inputs before persistence', async () => {
  expect((await post({ ...locator, language: 'zh-CN' }, 'cross-site')).status).toBe(403);
  expect((await post({ ...locator, language: 'zh-CN', owner: 'untrusted-owner' })).status).toBe(
    400,
  );
  expect((await post({ ...locator, language: 'zh-CN', score: 2 })).status).toBe(400);
  expect(provider).not.toHaveBeenCalled();
});

it('accepts explicit retry and keeps non-synthetic deployments disabled', async () => {
  generate.mockResolvedValue({ status: 'pending' });
  const retryToken = '00000000-0000-4000-8000-000000000001';
  const body = { ...locator, language: 'zh-CN', retryToken };
  expect(await (await post(body)).json()).toEqual({ status: 'pending' });
  expect(generate).toHaveBeenCalledWith(
    {
      owner: 'trusted-owner',
      locator: expect.objectContaining(locator),
      language: 'zh-CN',
      environment,
    },
    retryToken,
  );
  vi.stubEnv(
    'OPENMAIC_SIMULATED_LEARNING_LOOP',
    JSON.stringify({
      sourceNature: 'proxy',
      conditions: ['proxy'],
      memoryEnvironmentId: environment,
    }),
  );
  expect(await (await post(body)).json()).toEqual({ status: 'disabled' });
  expect(generate).toHaveBeenCalledTimes(1);
});
