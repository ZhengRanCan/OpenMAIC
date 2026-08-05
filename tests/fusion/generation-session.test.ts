import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import {
  appendFormalTeachingPrompt,
  completeFormalLessonOutlines,
  FormalFusionError,
  freezeFormalFusionForOutline,
  persistFormalLessonOutlines,
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
    courseScopeRef: { scopeId: 'course-1', revision: 'r1' },
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
    credentials: {
      get: vi.fn(async () => ({ token: 'delegation-secret', scope: ['preclass-context:read'] })),
    },
    sessions,
    outbox: {},
    circuits: { run: vi.fn(async (_capability, operation) => operation()) },
  } as unknown as ProductionFusionServices;
  configureProductionFusionServices(services);
  return { services, sessions, current: () => current };
}

function responseFor(body: string) {
  const request = JSON.parse(body) as {
    schemaVersion: string;
    semanticRequestId: string;
    semanticRequestRevision: string;
    semanticRequestDigest: string;
    normalizedTopic: string;
    normalizedLearningObjectives: string[];
    authorizedKnowledgeScope: { namespace: string; scopeId: string };
  };
  return {
    schemaVersion: request.schemaVersion,
    proposalId: 'proposal-1',
    basedOnSemanticRequestId: request.semanticRequestId,
    basedOnSemanticRequestRevision: request.semanticRequestRevision,
    semanticRequestDigest: request.semanticRequestDigest,
    resolutionStatus: 'ready',
    interpretedLessonSemantics: {
      normalizedTopic: request.normalizedTopic,
      normalizedLearningObjectives: request.normalizedLearningObjectives,
    },
    lessonKnowledgeMap: {
      mappingId: 'semantic-map-1',
      mappingRevision: '1',
      knowledgeRefs: [
        {
          namespace: request.authorizedKnowledgeScope.namespace,
          scopeId: request.authorizedKnowledgeScope.scopeId,
          id: 'semantic-point-1',
        },
      ],
    },
    learnerCognitiveProjection: { projectionRevision: '1', signals: ['insufficient_data'] },
    teachingGuidance: { guidanceRevision: '1', recommendedApproaches: ['worked-example'] },
    sourceRevisions: ['fixture'],
    clarificationIssues: [],
    warnings: [],
    createdAt: '2026-08-04T00:00:00.000Z',
  };
}

describe('F23 formal generation session', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('freezes one minimal context from the authoritative Cookie session and never renders identity', async () => {
    vi.stubEnv('FUSION_PERSISTENCE_MODE', 'local_postgres');
    vi.stubEnv('DEEPTUTOR_FUSION_BASE_URL', 'http://dt.local');
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async (_url: unknown, init?: RequestInit) =>
          new Response(JSON.stringify(responseFor(String(init?.body))), { status: 200 }),
      ),
    );
    const configured = configure(record());

    const frozen = await freezeFormalFusionForOutline(
      request(),
      'lesson-1',
      'Explain linear functions in fifteen minutes',
    );

    expect(frozen.kind).toBe('resolved');
    if (frozen.kind !== 'resolved') return;
    expect(frozen.context).toMatchObject({
      semanticRequest: { normalizedTopic: 'Explain linear functions in fifteen minutes' },
      proposal: {
        lessonKnowledgeMap: { mappingId: 'semantic-map-1', mappingRevision: '1' },
        learnerCognitiveProjection: { signals: ['insufficient_data'] },
      },
    });
    const prompt = appendFormalTeachingPrompt('', frozen.context);
    expect(prompt).toContain('mapped checkpoint');
    expect(prompt).toContain('worked-example');
    expect(prompt).not.toContain('allowlisted-synthetic-learner');
    expect(prompt).not.toContain('secret://');
    expect(configured.sessions.compareAndSet).toHaveBeenCalledTimes(1);

    const outlines = completeFormalLessonOutlines(frozen.context, [
      {
        id: 'teach-1',
        type: 'slide',
        title: 'Server generated teaching scene',
        description: 'Teach the frozen requirement.',
        keyPoints: ['point-1'],
        order: 1,
      },
    ]);
    expect(outlines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: expect.stringContaining('fusion-checkpoint-scene-'),
          type: 'quiz',
          fusionCheckpoint: expect.objectContaining({ mappingId: 'semantic-map-1' }),
        }),
        expect.objectContaining({ id: expect.stringContaining('fusion-remediation-scene-') }),
      ]),
    );
    await persistFormalLessonOutlines(request(), frozen, outlines);
    const reused = await resolveFormalFusion(request(), 'lesson-1');
    expect(reused).toMatchObject({ kind: 'resolved', context: frozen.context, outlines });
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

  it('surfaces non-ready semantic outcomes without touching the legacy snapshots or silently retrying', async () => {
    vi.stubEnv('FUSION_PERSISTENCE_MODE', 'local_postgres');
    vi.stubEnv('DEEPTUTOR_FUSION_BASE_URL', 'http://dt.local');
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async (_url: unknown, init?: RequestInit) =>
          new Response(
            JSON.stringify({
              ...responseFor(String(init?.body)),
              resolutionStatus: 'needs_clarification',
              clarificationIssues: ['objective_missing'],
            }),
            { status: 200 },
          ),
      ),
    );
    const configured = configure(record());

    await expect(
      freezeFormalFusionForOutline(request(), 'lesson-1', 'A requirement that needs clarification'),
    ).rejects.toMatchObject({ code: 'FUSION_CONTEXT_NEEDS_CLARIFICATION' });
    expect(configured.sessions.compareAndSet).toHaveBeenCalledTimes(1);
    expect(configured.current().generationContext).toBeUndefined();
    expect(configured.current().frozenLessonGenerationContext).toBeUndefined();
    expect(configured.current().preClassResolution).toMatchObject({
      status: 'needs_clarification',
    });
    clearProductionFusionServices(configured.services);
  });

  it('fails closed when a ready proposal supplies a Map outside the authorized semantic scope', async () => {
    vi.stubEnv('FUSION_PERSISTENCE_MODE', 'local_postgres');
    vi.stubEnv('DEEPTUTOR_FUSION_BASE_URL', 'http://dt.local');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: unknown, init?: RequestInit) => {
        const proposal = responseFor(String(init?.body));
        proposal.lessonKnowledgeMap.knowledgeRefs[0].scopeId = 'wrong-scope';
        return new Response(JSON.stringify(proposal), { status: 200 });
      }),
    );
    const configured = configure(record());

    await expect(
      freezeFormalFusionForOutline(request(), 'lesson-1', 'A bounded requirement'),
    ).rejects.toMatchObject({ code: 'FUSION_CONTEXT_INVALID' });
    expect(configured.sessions.compareAndSet).not.toHaveBeenCalled();
    clearProductionFusionServices(configured.services);
  });

  it('does not read the legacy Catalog when compiling a semantic checkpoint', async () => {
    vi.stubEnv('FUSION_PERSISTENCE_MODE', 'local_postgres');
    vi.stubEnv('DEEPTUTOR_FUSION_BASE_URL', 'http://dt.local');
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async (_url: unknown, init?: RequestInit) =>
          new Response(JSON.stringify(responseFor(String(init?.body))), { status: 200 }),
      ),
    );
    const invalid = record();
    invalid.sceneCatalog = { entries: [] };
    const configured = configure(invalid);

    const frozen = await freezeFormalFusionForOutline(
      request(),
      'lesson-1',
      'Explain linear functions in fifteen minutes',
    );
    expect(frozen.kind).toBe('resolved');
    clearProductionFusionServices(configured.services);
  });
});
