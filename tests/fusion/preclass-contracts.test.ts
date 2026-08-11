import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildClarifiedSemanticRequest,
  PRECLASS_CLARIFICATION_SCHEMA,
  PRECLASS_CONTRACT_VERSION,
  PreClassContractError,
  canonicalizeDigestEnvelope,
  computeSemanticRequestDigest,
  digestCanonicalBytes,
  parseFrozenLessonGenerationContext,
  parseLessonSemanticRequest,
  parsePreClassClarification,
  parseStrictJson,
} from '@/lib/fusion/preclass-contracts';

const fixturePath = resolve(
  process.cwd(),
  '../docs/harness/FUSION/fixtures/canonical-digest-v1.json',
);
const fixtures = JSON.parse(readFileSync(fixturePath, 'utf8')) as {
  successCases: Array<{
    purpose: 'semantic-request' | 'lesson-fact-set' | 'profile-update-candidate';
    valueSchemaVersion: string;
    canonicalValue: Record<string, unknown>;
    canonicalJson: string;
    utf8ByteLength: number;
    sha256: string;
  }>;
};
const semantic = fixtures.successCases[0];

function request(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: PRECLASS_CONTRACT_VERSION,
    semanticRequestId: 'request-01',
    semanticRequestRevision: '1',
    lessonSessionId: 'lesson-01',
    semanticRequestDigest: semantic.sha256,
    ...semantic.canonicalValue,
    warnings: [],
    ...overrides,
  };
}
function proposal(digest = semantic.sha256) {
  return {
    schemaVersion: PRECLASS_CONTRACT_VERSION,
    proposalId: 'proposal-01',
    basedOnSemanticRequestId: 'request-01',
    basedOnSemanticRequestRevision: '1',
    semanticRequestDigest: digest,
    resolutionStatus: 'ready',
    interpretedLessonSemantics: {
      normalizedTopic: semantic.canonicalValue.normalizedTopic as string,
      normalizedLearningObjectives: semantic.canonicalValue
        .normalizedLearningObjectives as string[],
    },
    lessonKnowledgeMap: {
      mappingId: 'map-01',
      mappingRevision: '1',
      knowledgeRefs: semantic.canonicalValue.requestedKnowledgeRefs,
    },
    learnerCognitiveProjection: { projectionRevision: '1', signals: ['synthetic-signal'] },
    teachingGuidance: { guidanceRevision: '1', recommendedApproaches: ['worked-example'] },
    sourceRevisions: ['source-1'],
    clarificationIssues: [],
    warnings: [],
    createdAt: '2026-07-31T15:00:00Z',
  };
}

describe('F40 pre-class contract kernel', () => {
  it('uses the one shared fixture file for canonical bytes, byte length and digest', () => {
    for (const entry of fixtures.successCases) {
      const bytes = canonicalizeDigestEnvelope(
        entry.purpose,
        entry.valueSchemaVersion,
        entry.canonicalValue,
      );
      expect(Buffer.from(bytes).toString('utf8')).toBe(entry.canonicalJson);
      expect(bytes.byteLength).toBe(entry.utf8ByteLength);
      expect(digestCanonicalBytes(bytes)).toBe(entry.sha256);
    }
  });

  it('parses the versioned request before accepting its semantic digest', () => {
    const parsed = parseLessonSemanticRequest(request());
    expect(computeSemanticRequestDigest(parsed)).toBe(semantic.sha256);
    expect(parsed.sourceMaterialRefs[0].materialId).toBe('material-01');
  });

  it.each([
    ['unknown_field', () => parseLessonSemanticRequest(request({ sceneId: 'browser-command' }))],
    [
      'unsupported_schema_version',
      () => parseLessonSemanticRequest(request({ schemaVersion: 'v2' })),
    ],
    [
      'digest_mismatch',
      () =>
        parseLessonSemanticRequest(
          request({
            semanticRequestDigest:
              'sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
          }),
        ),
    ],
    [
      'unauthorized_reference',
      () =>
        parseLessonSemanticRequest(
          request({
            requestedKnowledgeRefs: [
              { namespace: 'deeptutor', scopeId: 'other-scope', id: 'kp-linear-slope' },
            ],
          }),
        ),
    ],
    ['duplicate_key', () => parseStrictJson('{"topic":"one","topic":"two"}')],
    ['normalized_key_collision', () => parseStrictJson('{"e\\u0301":1,"é":2}')],
    ['invalid_unicode', () => parseStrictJson('{"topic":"\\ud800"}')],
    ['unsafe_integer', () => parseStrictJson('{"count":9007199254740992}')],
    ['payload_too_large', () => parseStrictJson('x'.repeat(256 * 1024 + 1))],
  ])('fails closed with %s', (code, run) => {
    try {
      run();
      throw new Error('expected parser failure');
    } catch (error) {
      expect(error).toBeInstanceOf(PreClassContractError);
      expect((error as PreClassContractError).code).toBe(code);
    }
  });

  it('rejects UI fields and cross-request mismatches in a frozen response', () => {
    const context = {
      schemaVersion: PRECLASS_CONTRACT_VERSION,
      contextId: 'context-01',
      semanticRequest: request(),
      proposal: proposal(),
      resolution: {
        schemaVersion: PRECLASS_CONTRACT_VERSION,
        semanticRequestId: 'request-01',
        semanticRequestRevision: '1',
        semanticRequestDigest: semantic.sha256,
        status: 'ready',
        clarificationIssues: [],
      },
      frozenAt: '2026-07-31T15:00:00Z',
    };
    expect(parseFrozenLessonGenerationContext(context).frozenAt).toBe('2026-07-31T15:00:00.000Z');
    expect(() =>
      parseFrozenLessonGenerationContext({
        ...context,
        proposal: { ...proposal(), sceneId: 'forbidden' },
      }),
    ).toThrow(/unknown_field/);
    expect(() =>
      parseFrozenLessonGenerationContext({
        ...context,
        resolution: { ...context.resolution, semanticRequestRevision: '2' },
      }),
    ).toThrow(/semantic_request_mismatch/);
    expect(() =>
      parseFrozenLessonGenerationContext({ ...context, frozenAt: '2026-07-31T15:00:00.1234Z' }),
    ).toThrow(/timestamp_precision_unsupported/);
  });
});

describe('F48 pre-class clarification revision contract', () => {
  const base = parseLessonSemanticRequest(request());

  it('builds exactly one clarified revision with a new digest while preserving lineage', () => {
    const clarified = buildClarifiedSemanticRequest(
      base,
      'Clarified topic: linear functions for beginners',
    );
    expect(clarified.semanticRequestId).toBe(base.semanticRequestId);
    expect(clarified.lessonSessionId).toBe(base.lessonSessionId);
    expect(clarified.semanticRequestRevision).toBe('2');
    expect(clarified.normalizedTopic).toBe('Clarified topic: linear functions for beginners');
    expect(clarified.normalizedLearningObjectives).toEqual([
      'Clarified topic: linear functions for beginners',
    ]);
    expect(clarified.semanticRequestDigest).not.toBe(base.semanticRequestDigest);
    expect(computeSemanticRequestDigest(clarified)).toBe(clarified.semanticRequestDigest);
    expect(clarified.warnings).toContain('clarified_by_initiator');
  });

  it.each([
    [
      'revision_limit_exceeded',
      () => buildClarifiedSemanticRequest(buildClarifiedSemanticRequest(base, 'First'), 'Second'),
    ],
    ['invalid_supplement', () => buildClarifiedSemanticRequest(base, '')],
    ['invalid_supplement', () => buildClarifiedSemanticRequest(base, 'x'.repeat(600))],
    ['invalid_supplement', () => buildClarifiedSemanticRequest(base, 42)],
  ])('fails closed with %s', (code, run) => {
    try {
      run();
      throw new Error('expected contract failure');
    } catch (error) {
      expect(error).toBeInstanceOf(PreClassContractError);
      expect((error as PreClassContractError).code).toBe(code);
    }
  });

  it('parses a stored clarification record strictly', () => {
    const clarified = buildClarifiedSemanticRequest(base, 'A concrete supplement');
    const record = parsePreClassClarification({
      schemaVersion: PRECLASS_CLARIFICATION_SCHEMA,
      basedOnSemanticRequestId: base.semanticRequestId,
      basedOnSemanticRequestRevision: '1',
      basedOnSemanticRequestDigest: base.semanticRequestDigest,
      semanticRequestId: clarified.semanticRequestId,
      semanticRequestRevision: '2',
      semanticRequestDigest: clarified.semanticRequestDigest,
      supplement: clarified.normalizedTopic,
      finalStatus: 'ready',
      createdAt: '2026-08-11T10:00:00Z',
    });
    expect(record.finalStatus).toBe('ready');
    expect(record.semanticRequestRevision).toBe('2');
    expect(record.basedOnSemanticRequestRevision).toBe('1');
    expect(() => parsePreClassClarification({ ...record, finalStatus: 'unsupported' })).toThrow(
      /invalid_clarification/,
    );
  });
});
