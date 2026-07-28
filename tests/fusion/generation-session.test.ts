import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import {
  appendFormalTeachingPrompt,
  FormalFusionError,
  freezeFormalFusionForOutline,
  resolveFormalFusion,
} from '@/lib/fusion/generation-session';
import {
  clearProductionFusionServices,
  configureProductionFusionServices,
  type ProductionFusionServices,
} from '@/lib/fusion/reliability/production-services';
import type { FusionSessionRecord } from '@/lib/fusion/session-store/types';

function request(cookie = 'browser-token') {
  return new NextRequest('http://openmaic.local/api/generate/scene-outlines-stream', {
    headers: { cookie: `openmaic_fusion_session=${cookie}` },
  });
}

function record(): FusionSessionRecord {
  return {
    schemaVersion: 'v1',
    lessonSessionId: 'lesson-1',
    learnerId: 'allowlisted-synthetic-learner',
    credentialRef: 'secret://delegation/1',
    profileSnapshot: {
      learnerId: 'allowlisted-synthetic-learner',
      knowledgeState: [
        { lessonKnowledgePointId: 'point-1', dataStatus: 'insufficient_data', confidence: 0 },
      ],
    },
    lessonKnowledgeMap: {
      mappingId: 'map-1',
      mappingRevision: '2',
      knowledgePoints: [{ lessonKnowledgePointId: 'point-1', mappingStatus: 'mapped' }],
    },
    sceneCatalog: {
      catalogId: 'catalog-1',
      entries: [
        {
          sceneId: 'checkpoint-1',
          role: 'checkpoint',
          checkpointId: 'catalog-checkpoint-1',
          lessonKnowledgePointIds: ['point-1'],
        },
        {
          sceneId: 'remediation-1',
          role: 'remediation',
          remediationForCheckpointId: 'catalog-checkpoint-1',
          lessonKnowledgePointIds: ['point-1'],
          teachingStrategyTags: ['catalog_concrete_example'],
        },
      ],
    },
    runtimeState: {},
    degradationState: 'none',
    snapshotCapturedAt: '2026-07-28T00:00:00.000Z',
    revision: 0,
    createdAt: '2026-07-28T00:00:00.000Z',
    updatedAt: '2026-07-28T00:00:00.000Z',
    expiresAt: '2099-07-28T00:00:00.000Z',
  };
}

function configure(current: FusionSessionRecord) {
  const sessions = {
    recover: vi.fn(async (token: string) => (token === 'browser-token' ? current : undefined)),
    compareAndSet: vi.fn(async (_id, revision, update) => {
      if (revision !== current.revision) return undefined;
      current = { ...update(current), revision: current.revision + 1 };
      return current;
    }),
  };
  const services = {
    credentials: {},
    sessions,
    outbox: {},
    circuits: {},
  } as unknown as ProductionFusionServices;
  configureProductionFusionServices(services);
  return { services, sessions, current: () => current };
}

describe('F23 formal generation session', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('freezes one minimal context from the authoritative Cookie session and never renders identity', async () => {
    vi.stubEnv('FUSION_PERSISTENCE_MODE', 'local_postgres');
    const configured = configure(record());

    const frozen = await freezeFormalFusionForOutline(
      request(),
      'lesson-1',
      'Explain linear functions in fifteen minutes',
    );

    expect(frozen.kind).toBe('resolved');
    if (frozen.kind !== 'resolved') return;
    expect(frozen.context).toMatchObject({
      lessonKnowledgePointIds: ['point-1'],
      mappingId: 'map-1',
      mappingRevision: '2',
      checkpoint: {
        checkpointId: 'catalog-checkpoint-1',
        remediationStrategy: 'catalog_concrete_example',
      },
    });
    expect(frozen.context.guidance).toContain('Do not infer mastery from missing data.');
    const prompt = appendFormalTeachingPrompt('', frozen.context);
    expect(prompt).toContain('mapped checkpoint');
    expect(prompt).not.toContain('allowlisted-synthetic-learner');
    expect(prompt).not.toContain('secret://');
    expect(configured.sessions.compareAndSet).toHaveBeenCalledTimes(1);

    const reused = await resolveFormalFusion(request(), 'lesson-1');
    expect(reused).toMatchObject({ kind: 'resolved', context: frozen.context });
    await expect(
      freezeFormalFusionForOutline(request(), 'lesson-1', 'Forged replacement topic'),
    ).rejects.toMatchObject({ code: 'FUSION_SESSION_ALREADY_GENERATED' });
    clearProductionFusionServices(configured.services);
  });

  it('rejects missing, forged, or mismatched browser session bindings', async () => {
    vi.stubEnv('FUSION_PERSISTENCE_MODE', 'local_postgres');
    const configured = configure(record());

    await expect(resolveFormalFusion(request('forged'), 'lesson-1')).rejects.toMatchObject({
      code: 'FUSION_SESSION_UNAVAILABLE',
    } satisfies Partial<FormalFusionError>);
    await expect(resolveFormalFusion(request(), 'lesson-2')).rejects.toMatchObject({
      code: 'FUSION_SESSION_MISMATCH',
    } satisfies Partial<FormalFusionError>);
    clearProductionFusionServices(configured.services);
  });

  it('rejects a session whose frozen Catalog cannot pair a mapped checkpoint with remediation', async () => {
    vi.stubEnv('FUSION_PERSISTENCE_MODE', 'local_postgres');
    const invalid = record();
    invalid.sceneCatalog = { entries: [] };
    const configured = configure(invalid);

    await expect(
      freezeFormalFusionForOutline(
        request(),
        'lesson-1',
        'Explain linear functions in fifteen minutes',
      ),
    ).rejects.toMatchObject({ code: 'FUSION_CONTEXT_INVALID' });
    clearProductionFusionServices(configured.services);
  });
});
