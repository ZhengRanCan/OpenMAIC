/**
 * A classic run is started with the outline review the learner chose: a
 * learner who asked to always review outlines confirms each one (`wait`);
 * any other run confirms its own outline on the server after a short pause
 * (`countdown`) and goes on whether or not a page is open.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const started = vi.hoisted(() => ({ inputs: [] as Array<Record<string, unknown>> }));
vi.mock('@/lib/generation-run-client/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/generation-run-client/api')>()),
  startGenerationRun: async (input: Record<string, unknown>) => {
    started.inputs.push(input);
    return { id: 'run-AAAAAAAAAAAAAAAA' };
  },
}));
vi.mock('@/lib/orchestration/registry/store', () => ({
  whenAgentRegistryLoaded: async () => true,
  useAgentRegistry: { getState: () => ({ getAgent: () => undefined }) },
}));
vi.mock('@/lib/audio/tts-selection', () => ({ ttsSelection: () => null }));

import { RunStartRefusedError, startClassicRun } from '@/lib/generation-run-client/start';
import type { ModelCapabilities } from '@/lib/model-settings/capabilities';
import { useSettingsStore } from '@/lib/store/settings';
import { useUserProfileStore } from '@/lib/store/user-profile';

const start = (extra: Partial<Parameters<typeof startClassicRun>[0]> = {}) =>
  startClassicRun({
    requirement: 'Photosynthesis',
    materialIds: [],
    interactive: false,
    taskEngine: false,
    capabilities: {} as ModelCapabilities,
    ...extra,
  });

beforeEach(() => {
  started.inputs = [];
  useUserProfileStore.setState({ nickname: '', bio: '' });
});
afterEach(() => {
  useSettingsStore.setState({ reviewOutlineEnabled: false });
  useUserProfileStore.setState({ nickname: '', bio: '' });
});

describe('simulated Memory in a classic run', () => {
  it('preserves the original account profile and request shape when no Memory is selected', async () => {
    useUserProfileStore.setState({ nickname: 'Current learner', bio: 'Personal profile' });
    await start();
    expect(started.inputs[0]).toMatchObject({
      learnerProfile: { nickname: 'Current learner', bio: 'Personal profile' },
    });
    expect(started.inputs[0]).not.toHaveProperty('simulatedLearner');
  });

  it.each(['A', 'B', 'C'] as const)(
    'sends student %s without the account nickname or bio',
    async (simulatedLearner) => {
      useUserProfileStore.setState({ nickname: 'Current learner', bio: 'Personal profile' });
      await start({ simulatedLearner });
      expect(started.inputs[0]).toMatchObject({ simulatedLearner });
      expect(started.inputs[0]).not.toHaveProperty('learnerProfile');
    },
  );

  it.each([{ interactive: true }, { taskEngine: true }])(
    'refuses unsupported modes before submission: %j',
    async (mode) => {
      await expect(start({ simulatedLearner: 'B', ...mode })).rejects.toMatchObject({
        reason: 'generation.simulatedLearnerUnsupported',
        name: RunStartRefusedError.name,
      });
      expect(started.inputs).toHaveLength(0);
    },
  );
});

describe('the outline review a classic run is started with', () => {
  it('lets the run confirm its own outline after a countdown when the learner does not review outlines', async () => {
    useSettingsStore.setState({ reviewOutlineEnabled: false });
    await start();
    expect(started.inputs).toHaveLength(1);
    expect(started.inputs[0]).toMatchObject({ outlineReview: 'countdown' });
  });

  it('waits for the learner when they asked to always review outlines', async () => {
    useSettingsStore.setState({ reviewOutlineEnabled: true });
    await start();
    expect(started.inputs[0]).toMatchObject({ outlineReview: 'wait' });
  });

  it('reads the setting when the run starts', async () => {
    useSettingsStore.setState({ reviewOutlineEnabled: true });
    await start();
    useSettingsStore.setState({ reviewOutlineEnabled: false });
    await start();
    expect(started.inputs.map((input) => input.outlineReview)).toEqual(['wait', 'countdown']);
  });
});
