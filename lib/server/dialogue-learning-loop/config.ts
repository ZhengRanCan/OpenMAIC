import {
  readSimulatedLearningLoopConfig,
  type SimulatedLearningLoopConfig,
} from '../quiz-learning-loop/config';
export type DialogueLoopConfig = SimulatedLearningLoopConfig;
export function readDialogueLoopConfig(
  env: Record<string, string | undefined> = process.env,
): DialogueLoopConfig | null {
  if (env.OPENMAIC_AUTOMATIC_DIALOGUE_LOOP !== 'true') return null;
  const config = readSimulatedLearningLoopConfig(env);
  if (!config) throw Error('DIALOGUE_LOOP_ISOLATED_CONFIGURATION_REQUIRED');
  return config;
}
