import type { LearningLoopAttribution } from './store';

export type SimulatedLearningLoopConfig = Omit<LearningLoopAttribution, 'student'>;

/** Explicit deployment opt-in for an isolated simulation; no source type is inferred. */
export function readSimulatedLearningLoopConfig(
  environment: Record<string, string | undefined> = process.env,
): SimulatedLearningLoopConfig | null {
  const raw = environment.OPENMAIC_SIMULATED_LEARNING_LOOP;
  if (!raw) return null;
  let input: unknown;
  try {
    input = JSON.parse(raw);
  } catch {
    throw new Error('INVALID_LEARNING_LOOP_CONFIGURATION');
  }
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('INVALID_LEARNING_LOOP_CONFIGURATION');
  const value = input as Record<string, unknown>;
  if (
    Object.keys(value).some(
      (key) => !['sourceNature', 'conditions', 'memoryEnvironmentId'].includes(key),
    ) ||
    !['proxy', 'synthetic'].includes(value.sourceNature as string) ||
    !Array.isArray(value.conditions) ||
    value.conditions.length === 0 ||
    value.conditions.length > 16 ||
    value.conditions.some(
      (item) => typeof item !== 'string' || item.trim().length === 0 || item.length > 500,
    ) ||
    typeof value.memoryEnvironmentId !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value.memoryEnvironmentId,
    )
  )
    throw new Error('INVALID_LEARNING_LOOP_CONFIGURATION');
  return {
    sourceNature: value.sourceNature as 'proxy' | 'synthetic',
    conditions: [...value.conditions] as string[],
    memoryEnvironmentId: value.memoryEnvironmentId,
  };
}
