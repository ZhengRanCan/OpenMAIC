import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import {
  appendFormalTeachingPrompt,
  completeFormalLessonOutlines,
  FormalFusionError,
  freezeFormalFusionForOutline,
  persistFormalLessonOutlines,
  resolveFormalFusion,
  submitPreClassClarification,
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
    expect(configured.current().sceneCatalog).toMatchObject({
      semanticRequestDigest: frozen.context.semanticRequest.semanticRequestDigest,
      entries: expect.arrayContaining([
        expect.objectContaining({ role: 'checkpoint' }),
        expect.objectContaining({ role: 'remediation' }),
      ]),
    });
    expect(configured.current().runtimeState).toMatchObject({
      currentSceneId: expect.stringContaining('fusion-checkpoint-scene-'),
    });
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

  it('fails closed when the persisted formal catalog is missing or digest-mismatched', async () => {
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
    await persistFormalLessonOutlines(request(), frozen, outlines);

    const persistedCatalog = configured.current().sceneCatalog;
    delete (configured.current() as { sceneCatalog?: unknown }).sceneCatalog;
    await expect(resolveFormalFusion(request(), 'lesson-1')).rejects.toMatchObject({
      code: 'FUSION_CONTEXT_INVALID',
    });

    configured.current().sceneCatalog = {
      ...(persistedCatalog as Record<string, unknown>),
      semanticRequestDigest: 'sha256:'.concat('b'.repeat(64)),
    };
    await expect(resolveFormalFusion(request(), 'lesson-1')).rejects.toMatchObject({
      code: 'FUSION_CONTEXT_INVALID',
    });
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

describe('F48 pre-class clarification revision flow', () => {
  const env = () => {
    vi.stubEnv('FUSION_PERSISTENCE_MODE', 'local_postgres');
    vi.stubEnv('DEEPTUTOR_FUSION_BASE_URL', 'http://dt.local');
  };
  const stubProposal = (resolutionStatus: string, clarificationIssues: string[] = []) =>
    vi.fn(
      async (_url: unknown, init?: RequestInit) =>
        new Response(
          JSON.stringify({
            ...responseFor(String(init?.body)),
            resolutionStatus,
            clarificationIssues,
          }),
          { status: 200 },
        ),
    );

  it('lets the initiator submit one clarification that freezes a new revision context', async () => {
    env();
    vi.stubGlobal('fetch', stubProposal('needs_clarification', ['requirement_ambiguous']));
    const configured = configure(record());
    await expect(
      freezeFormalFusionForOutline(request(), 'lesson-1', 'Vague topic'),
    ).rejects.toMatchObject({ code: 'FUSION_CONTEXT_NEEDS_CLARIFICATION' });
    expect(configured.current().preClassResolution).toMatchObject({
      status: 'needs_clarification',
    });
    expect(configured.current().preClassSemanticRequest).toMatchObject({
      semanticRequestRevision: '1',
    });
    const priorDigest =
      (configured.current().preClassSemanticRequest as { semanticRequestDigest?: string })
        ?.semanticRequestDigest ?? '';

    vi.stubGlobal('fetch', stubProposal('ready'));
    const resolved = await submitPreClassClarification(
      request(),
      'lesson-1',
      'Clarified: linear functions for beginners',
    );
    expect(resolved.kind).toBe('resolved');
    if (resolved.kind !== 'resolved') return;
    expect(resolved.context.semanticRequest.semanticRequestRevision).toBe('2');
    expect(resolved.context.semanticRequest.normalizedTopic).toBe(
      'Clarified: linear functions for beginners',
    );
    expect(resolved.context.semanticRequest.semanticRequestDigest).not.toBe(priorDigest);
    const stored = configured.current();
    expect(stored.frozenLessonGenerationContext).toBeDefined();
    expect(stored.preClassClarification).toMatchObject({
      finalStatus: 'ready',
      semanticRequestRevision: '2',
      basedOnSemanticRequestRevision: '1',
    });
    clearProductionFusionServices(configured.services);
  });

  it.each(['partial', 'unresolved', 'rejected'])(
    'fails closed when the prior outcome is %s and cannot be clarified',
    async (status) => {
      env();
      vi.stubGlobal('fetch', stubProposal(status, ['not_recoverable']));
      const configured = configure(record());
      await expect(
        freezeFormalFusionForOutline(request(), 'lesson-1', 'Requirement'),
      ).rejects.toMatchObject({ code: `FUSION_CONTEXT_${status.toUpperCase()}` });
      await expect(
        submitPreClassClarification(request(), 'lesson-1', 'Supplement'),
      ).rejects.toMatchObject({ code: `FUSION_CONTEXT_${status.toUpperCase()}` });
      expect(configured.current().preClassClarification).toBeUndefined();
      expect(configured.current().frozenLessonGenerationContext).toBeUndefined();
      clearProductionFusionServices(configured.services);
    },
  );

  it('enforces the one-revision limit and never mutates an existing frozen context', async () => {
    env();
    vi.stubGlobal('fetch', stubProposal('needs_clarification', ['requirement_ambiguous']));
    const configured = configure(record());
    await expect(
      freezeFormalFusionForOutline(request(), 'lesson-1', 'Vague topic'),
    ).rejects.toMatchObject({ code: 'FUSION_CONTEXT_NEEDS_CLARIFICATION' });

    vi.stubGlobal('fetch', stubProposal('ready'));
    const resolved = await submitPreClassClarification(request(), 'lesson-1', 'Concrete topic now');
    expect(resolved.kind).toBe('resolved');
    if (resolved.kind !== 'resolved') return;
    const frozenDigest = (
      resolved.context.semanticRequest.semanticRequestDigest
        ? resolved.context.semanticRequest.semanticRequestDigest
        : ''
    ) as string;
    await expect(
      submitPreClassClarification(request(), 'lesson-1', 'Second revision attempt'),
    ).rejects.toMatchObject({ code: 'FUSION_SESSION_ALREADY_GENERATED' });
    expect(configured.current().frozenLessonGenerationContext).toBeDefined();
    expect(
      (
        configured.current().frozenLessonGenerationContext as {
          semanticRequest?: { semanticRequestDigest?: string };
        }
      )?.semanticRequest?.semanticRequestDigest,
    ).toBe(frozenDigest);
    clearProductionFusionServices(configured.services);
  });

  it('records a non-ready revised outcome, then refuses any further revision', async () => {
    env();
    vi.stubGlobal('fetch', stubProposal('needs_clarification', ['requirement_ambiguous']));
    const configured = configure(record());
    await expect(
      freezeFormalFusionForOutline(request(), 'lesson-1', 'Vague topic'),
    ).rejects.toMatchObject({ code: 'FUSION_CONTEXT_NEEDS_CLARIFICATION' });

    vi.stubGlobal('fetch', stubProposal('needs_clarification', ['still_ambiguous']));
    await expect(
      submitPreClassClarification(request(), 'lesson-1', 'Still vague'),
    ).rejects.toMatchObject({ code: 'FUSION_CONTEXT_NEEDS_CLARIFICATION' });
    expect(configured.current().preClassClarification).toMatchObject({
      finalStatus: 'needs_clarification',
      semanticRequestRevision: '2',
    });
    await expect(
      submitPreClassClarification(request(), 'lesson-1', 'One more attempt'),
    ).rejects.toMatchObject({ code: 'FUSION_CONTEXT_REVISION_LIMIT' });
    clearProductionFusionServices(configured.services);
  });

  it('fails closed without a stored clarification state or on a stale session', async () => {
    env();
    vi.stubGlobal('fetch', stubProposal('ready'));
    const configured = configure(record());
    await expect(
      submitPreClassClarification(request(), 'lesson-1', 'Supplement'),
    ).rejects.toMatchObject({ code: 'FUSION_CONTEXT_INVALID' });
    await expect(
      submitPreClassClarification(request('other-token'), 'lesson-1', 'Supplement'),
    ).rejects.toMatchObject({ code: 'FUSION_SESSION_UNAVAILABLE' });
    clearProductionFusionServices(configured.services);
  });
});

describe('F49 pre-class context shadow wiring', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  const env = (shadow = false) => {
    vi.stubEnv('FUSION_PERSISTENCE_MODE', 'local_postgres');
    vi.stubEnv('DEEPTUTOR_FUSION_BASE_URL', 'http://dt.local');
    if (shadow) vi.stubEnv('FUSION_PRECLASS_CONTEXT_SHADOW_ENABLED', 'true');
  };

  it('invokes the shadow read in the formal freeze path when enabled and persists only redacted metadata', async () => {
    env(true);
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
    await vi.waitFor(() => {
      expect(configured.sessions.compareAndSet).toHaveBeenCalledTimes(2);
      expect(configured.current().preClassContextShadow).toBeDefined();
    });
    const stored = configured.current();
    expect(stored.preClassContextShadow).toMatchObject({ status: 'captured' });
    const serialized = JSON.stringify(stored.preClassContextShadow);
    expect(serialized).not.toContain('allowlisted-synthetic-learner');
    expect(serialized).not.toContain('delegation-secret');
    expect(serialized).not.toContain('secret://');
    clearProductionFusionServices(configured.services);
  });

  it('classifies shadow provider failure without blocking or mutating the formal resolution', async () => {
    env(true);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: unknown, init?: RequestInit) => {
        const body = String(init?.body);
        if (body.includes('"namespace":"openmaic"')) throw new Error('shadow provider down');
        return new Response(JSON.stringify(responseFor(body)), { status: 200 });
      }),
    );
    const configured = configure(record());

    const frozen = await freezeFormalFusionForOutline(
      request(),
      'lesson-1',
      'Explain linear functions in fifteen minutes',
    );

    expect(frozen.kind).toBe('resolved');
    if (frozen.kind !== 'resolved') return;
    expect(frozen.context.semanticRequest.normalizedTopic).toBe(
      'Explain linear functions in fifteen minutes',
    );
    await vi.waitFor(() => {
      expect(configured.current().preClassContextShadow).toBeDefined();
    });
    expect(configured.current().preClassContextShadow).toMatchObject({
      status: 'provider_failed',
      errorCode: 'provider_unavailable',
    });
    expect(configured.current().frozenLessonGenerationContext).toBeDefined();
    clearProductionFusionServices(configured.services);
  });

  it('skips the shadow read entirely when the flag is not enabled', async () => {
    env();
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
    expect(configured.sessions.compareAndSet).toHaveBeenCalledTimes(1);
    expect(configured.current().preClassContextShadow).toBeUndefined();
    clearProductionFusionServices(configured.services);
  });
});
