import { describe, expect, it } from 'vitest';
import { assertFormalPairOutlines, FormalMaterializationError } from '@/lib/fusion/materialization';
import type { SceneOutline } from '@/lib/types/generation';

const outline = (patch: Partial<SceneOutline>): SceneOutline => ({
  id: 'teach-1', type: 'slide', title: 'Teach', description: 'Teach', keyPoints: ['k'], order: 1, ...patch,
});

describe('formal Fusion materialization guard', () => {
  it('requires exactly one server-owned checkpoint and remediation pair', () => {
    expect(() => assertFormalPairOutlines([
      outline({ id: 'fusion-checkpoint-scene-c1', type: 'quiz', fusionRole: 'checkpoint', fusionCheckpoint: {
        checkpointId: 'fusion-checkpoint-c1', mappingId: 'm1', mappingRevision: '1', lessonKnowledgePointIds: ['k'], remediationStrategy: 'worked-example',
      }}),
      outline({ id: 'fusion-remediation-scene-c1', type: 'slide', order: 2, fusionRole: 'remediation' }),
    ])).not.toThrow();
  });

  it('requires binding fields and matching checkpoint context', () => {
    expect(() => assertFormalPairOutlines([
      outline({ id: 'fusion-checkpoint-sc1', type: 'quiz', fusionRole: 'checkpoint', fusionCheckpoint: {
        checkpointId: 'wrong', mappingId: '', mappingRevision: '', lessonKnowledgePointIds: [], remediationStrategy: '',
      }}),
      outline({ id: 'fusion-remediation-sc1', type: 'slide', order: 2, fusionRole: 'remediation' }),
    ])).toThrowError(expect.objectContaining({ code: 'PAIR_PLAN_MISSING' } satisfies Partial<FormalMaterializationError>));
  });

  it('fails closed when the formal pair is incomplete', () => {
    expect(() => assertFormalPairOutlines([outline({ id: 'ordinary-quiz', type: 'quiz' })]))
      .toThrowError(expect.objectContaining({ code: 'PAIR_PLAN_MISSING' } satisfies Partial<FormalMaterializationError>));
  });
});
