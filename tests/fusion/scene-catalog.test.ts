import { describe, expect, it } from 'vitest';
import { DEVELOPMENT_SCENE_CATALOG } from '@/lib/fusion/scene-catalog';
describe('F10 Scene Catalog', () => it('freezes checkpoint and reviewable remediation metadata', () => {
  const checkpoint = DEVELOPMENT_SCENE_CATALOG.entries.find((entry) => entry.role === 'checkpoint'); const remediation = DEVELOPMENT_SCENE_CATALOG.entries.find((entry) => entry.role === 'remediation');
  expect(checkpoint?.checkpointId).toBe('development-checkpoint'); expect(remediation?.remediationForCheckpointId).toBe(checkpoint?.checkpointId); expect(remediation?.teachingStrategyTags).toContain('development_mock_concrete_example');
}));
