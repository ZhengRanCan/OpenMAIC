import { describe, expect, it } from 'vitest';
import { DEVELOPMENT_SCENE_CATALOG } from '@/lib/fusion/scene-catalog';
import { applyDirective, createLessonRuntimeState } from '@/lib/fusion/lesson-runtime-state';
import { planSceneDirective } from '@/lib/fusion/scene-directive-planner';

const incorrect = { schemaVersion: 'v1' as const, kind: 'insert_remediation' as const, targetLessonKnowledgePointIds: ['lesson-linear-function-slope'], recommendedStrategy: 'development_mock_concrete_example' };
describe('F11 in-class adjustment', () => it('inserts a remediation once, then is idempotent and continues safely', () => {
  const initial = createLessonRuntimeState(); const first = planSceneDirective(incorrect, 'event-1', DEVELOPMENT_SCENE_CATALOG, initial); const applied = applyDirective(initial, first.directive);
  expect(applied?.currentSceneId).toBe('remediate-slope-concrete');
  expect(applyDirective(applied!, first.directive)).toBeNull();
  expect(planSceneDirective(incorrect, 'event-1', DEVELOPMENT_SCENE_CATALOG, applied!).directive.reasonCode).toBe('duplicate_event');
}));

it('continues for a correct answer and retries only the current checkpoint once', () => {
  const initial = createLessonRuntimeState();
  const correct = planSceneDirective({ schemaVersion: 'v1' as const, kind: 'continue' as const, targetLessonKnowledgePointIds: [], recommendedStrategy: 'development_mock_continue' }, 'correct-event', DEVELOPMENT_SCENE_CATALOG, initial);
  expect(correct.directive.kind).toBe('continue');
  const retry = planSceneDirective({ ...incorrect, kind: 'retry_checkpoint' }, 'retry-event', DEVELOPMENT_SCENE_CATALOG, initial);
  const afterRetry = applyDirective(initial, retry.directive)!;
  expect(afterRetry.currentSceneId).toBe('checkpoint-slope');
  expect(planSceneDirective({ ...incorrect, kind: 'retry_checkpoint' }, 'retry-again', DEVELOPMENT_SCENE_CATALOG, afterRetry).directive.reasonCode).toBe('retry_limit_reached');
});
