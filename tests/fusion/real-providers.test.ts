import { describe, expect, it, vi } from 'vitest';
import { storeDelegation } from '@/lib/fusion/identity/delegation-store';
import {
  requestRealDiagnosis,
  submitRealUpdate,
} from '@/lib/fusion/adapter/real-event-update-provider';
import { isProductionFusion } from '@/lib/fusion/reliability/production-services';
it('uses delegated event and update transports and degrades per capability', async () => {
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('FUSION_PERSISTENCE_MODE', '');
  storeDelegation({
    token: 'secret',
    tokenId: 't',
    learnerId: 'integration-test',
    audience: 'openmaic',
    scope: ['diagnosis:request'],
    expiresAt: 9999999999,
    lessonSessionId: 'lesson',
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ schemaVersion: 'v1' }), { status: 200 })),
  );
  const result = await requestRealDiagnosis({ lessonSessionId: 'lesson' });
  expect(result.schemaVersion).toBe('v1');
  await expect(submitRealUpdate({ lessonSessionId: 'missing' })).rejects.toThrow(
    'capability_unavailable',
  );
  vi.unstubAllEnvs();
});
it('treats explicit local_postgres persistence as a server-side Fusion mode', () => {
  vi.stubEnv('FUSION_PERSISTENCE_MODE', 'local_postgres');
  expect(isProductionFusion()).toBe(true);
});
