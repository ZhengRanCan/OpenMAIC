import { describe, expect, it } from 'vitest';
import { parseEvidenceRestriction, parseOrganizeRequest } from '@/lib/evidence/contracts';

const request = () => ({
  operationId: '3cc57ae4-af0b-4f27-b094-ad08d37456bb',
  stageId: 'stage',
  anchor: { attemptId: 'attempt', submissionId: 'submission' },
  related: [],
  language: 'zh-CN',
  action: 'reuse-or-create',
});
describe('evidence request boundaries', () => {
  it('accepts the bounded request and rejects identity/raw payload injection', () => {
    expect(parseOrganizeRequest(request()).stageId).toBe('stage');
    expect(() => parseOrganizeRequest({ ...request(), owner: 'someone' })).toThrow();
    expect(() =>
      parseOrganizeRequest({ ...request(), anchor: { ...request().anchor, answer: 'A' } }),
    ).toThrow();
  });
  it('rejects duplicate sources, invalid identifiers and incomplete reanalysis', () => {
    expect(() => parseOrganizeRequest({ ...request(), related: [request().anchor] })).toThrow();
    expect(() => parseOrganizeRequest({ ...request(), operationId: 'not-a-uuid' })).toThrow();
    expect(() => parseOrganizeRequest({ ...request(), stageId: '../stage' })).toThrow();
    expect(() => parseOrganizeRequest({ ...request(), action: 'reanalyze' })).toThrow();
    expect(() => parseOrganizeRequest({ ...request(), previousRunId: 'old' })).toThrow();
    expect(() =>
      parseOrganizeRequest({
        ...request(),
        related: [
          { attemptId: 'a2', submissionId: 's2' },
          { attemptId: 'a3', submissionId: 's3' },
        ],
      }),
    ).toThrow();
  });
  it('bounds identifiers and strictly accepts only downwards restrictions', () => {
    expect(parseOrganizeRequest({ ...request(), stageId: 'a'.repeat(160) }).stageId).toHaveLength(
      160,
    );
    expect(() => parseOrganizeRequest({ ...request(), stageId: 'a'.repeat(161) })).toThrow();
    const restriction = {
      restrictionId: request().operationId,
      itemIds: [],
      code: 'needs-recheck',
      reason: 'Known source issue',
      sourceRefs: [],
    };
    expect(parseEvidenceRestriction(restriction).itemIds).toEqual([]);
    expect(() => parseEvidenceRestriction({ ...restriction, approved: true })).toThrow();
    expect(() => parseEvidenceRestriction({ ...restriction, reason: 'a'.repeat(8001) })).toThrow();
  });
});
