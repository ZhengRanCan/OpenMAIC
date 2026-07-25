import { describe, expect, it, vi } from 'vitest';
import { storeDelegation } from '@/lib/fusion/identity/delegation-store';
import { getRealProfile } from '@/lib/fusion/adapter/real-profile-provider';
import {
  requestRealDiagnosis,
  submitRealUpdate,
} from '@/lib/fusion/adapter/real-event-update-provider';
import { isProductionFusion } from '@/lib/fusion/reliability/production-services';
describe('F18 real profile provider', () =>
  it('uses server delegation and returns only minimal profile', async () => {
    vi.stubEnv('DEEPTUTOR_FUSION_BASE_URL', 'http://dt.local');
    storeDelegation({
      token: 'secret',
      tokenId: 't',
      learnerId: 'integration-test',
      audience: 'openmaic',
      scope: ['profile:read'],
      expiresAt: 9999999999,
      lessonSessionId: 'lesson',
    });
    const value = await getRealProfile(
      'lesson',
      async () =>
        new Response(
          JSON.stringify({ schemaVersion: 'v1', learnerId: 'integration-test', warnings: [] }),
        ),
    );
    expect(value.learnerId).toBe('integration-test');
  }));
it('uses delegated event and update transports and degrades per capability', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ schemaVersion: 'v1' }), { status: 200 })),
  );
  const result = await requestRealDiagnosis({ lessonSessionId: 'lesson' });
  expect(result.schemaVersion).toBe('v1');
  await expect(submitRealUpdate({ lessonSessionId: 'missing' })).rejects.toThrow(
    'capability_unavailable',
  );
});
it('treats explicit local_postgres persistence as a server-side Fusion mode', () => {
  vi.stubEnv('FUSION_PERSISTENCE_MODE', 'local_postgres');
  expect(isProductionFusion()).toBe(true);
});
