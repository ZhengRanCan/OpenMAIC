import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildOutlinePrompt } from '@openmaic/generation';

import { StepAbortedError } from '@/lib/server/generation/steps/context';
import {
  generateOutlines,
  OutlineGenerationError,
  type OutlineEvent,
  type OutlineInput,
} from '@/lib/server/generation/steps/outline';

import { fakeModel, testLogger } from './helpers';

const mocks = vi.hoisted(() => ({
  streamLLM: vi.fn(),
  capabilities: vi.fn(),
}));

vi.mock('@/lib/ai/llm', () => ({ streamLLM: mocks.streamLLM }));
vi.mock('@/lib/server/generation-capabilities', () => ({
  resolveServerGenerationCapabilities: mocks.capabilities,
}));

const model = fakeModel();

const body: Omit<OutlineInput, 'model'> = {
  requirements: { requirement: 'Teach fractions to ten-year-olds' } as OutlineInput['requirements'],
  pdfText: '',
  pdfImages: [],
  imageMapping: {},
  researchContext: '',
};

const OUTLINE_TEXT = JSON.stringify({
  languageDirective: 'Teach in English.',
  courseTitle: 'Fractions',
  outlines: [
    { id: 'o1', type: 'slide', title: 'Halves', description: 'd', keyPoints: ['a'] },
    { id: 'o2', type: 'quiz', title: 'Check', description: 'd', keyPoints: ['b'] },
  ],
});

/** Each stream call answers the next text in turn (the last one repeats). */
function streams(...texts: string[]) {
  let call = 0;
  mocks.streamLLM.mockImplementation(() => {
    const text = texts[Math.min(call++, texts.length - 1)]!;
    return {
      fullStream: (async function* () {
        // Split the answer so the outlines are parsed incrementally.
        const middle = Math.floor(text.length / 2);
        for (const chunk of [text.slice(0, middle), text.slice(middle)]) {
          if (chunk) yield { type: 'text-delta', text: chunk };
        }
        yield { type: 'finish', finishReason: 'stop' };
      })(),
    };
  });
}

function stepContext(events: OutlineEvent[], signal?: AbortSignal) {
  return {
    log: testLogger(),
    signal,
    emit: (event: OutlineEvent) => events.push(event),
    workspaceId: null,
    resolveVisionImages: async (images: readonly { id: string; src: string }[]) => [...images],
  };
}

describe('outline step', () => {
  afterEach(() => vi.unstubAllEnvs());

  beforeEach(() => {
    vi.resetModules();
    mocks.streamLLM.mockReset();
    mocks.capabilities.mockReset();
    mocks.capabilities.mockResolvedValue({
      webSearch: false,
      imageGeneration: false,
      videoGeneration: false,
      tts: false,
    });
  });

  it('reports the directive, the title and each outline as the model writes them', async () => {
    streams(OUTLINE_TEXT);
    const events: OutlineEvent[] = [];
    const result = await generateOutlines({ ...body, model }, stepContext(events));

    expect(events.map((event) => event.type)).toEqual([
      'languageDirective',
      'courseTitle',
      'outline',
      'outline',
    ]);
    expect(result).toMatchObject({
      languageDirective: 'Teach in English.',
      courseTitle: 'Fractions',
      taskEngineMode: false,
      outlines: [
        { id: 'o1', order: 1, title: 'Halves' },
        { id: 'o2', order: 2, title: 'Check' },
      ],
    });
    expect(mocks.capabilities).toHaveBeenCalledWith(null);
  });

  it('keeps requests without Learner Context identical to the package prompt', async () => {
    streams(OUTLINE_TEXT);
    await generateOutlines({ ...body, model }, stepContext([]));
    const original = buildOutlinePrompt(body.requirements);
    expect(mocks.streamLLM.mock.calls[0]![0]).toMatchObject({
      system: original.system,
      prompt: original.user,
    });
    expect(original.user).not.toContain('## Learner Context');
  });

  it('sends the original selected record and conditions in the classic model request', async () => {
    streams(OUTLINE_TEXT);
    const learnerContext = '经历：有公式提示时完成密度题。\n条件：提供了单位换算表。';
    const requirements = {
      ...body.requirements,
      userNickname: 'Browser nickname',
      userBio: 'Browser bio',
    };
    await generateOutlines({ ...body, requirements, learnerContext, model }, stepContext([]));
    const request = mocks.streamLLM.mock.calls[0]![0] as { system: string; prompt: string };
    expect(request.prompt).toBe(buildOutlinePrompt(requirements, { learnerContext }).user);
    expect(request.prompt).toContain('## Learner Context');
    expect(request.prompt.endsWith(learnerContext)).toBe(true);
    expect(request.prompt).not.toContain('## Student Profile');
    expect(request.prompt).not.toContain('Browser nickname');
    expect(request.prompt).not.toContain('Browser bio');
    expect(requirements.userBio).toBe('Browser bio');
  });

  it.each([
    { mode: { interactiveMode: true }, vocational: 'false' },
    { mode: { taskEngineMode: true }, vocational: 'true' },
    { mode: { taskEngineMode: true }, vocational: 'false' },
  ])('rejects Context before calling the model for %j', async ({ mode, vocational }) => {
    vi.stubEnv('OPENMAIC_ENABLE_VOCATIONAL', vocational);
    await expect(
      generateOutlines(
        {
          ...body,
          requirements: { ...body.requirements, ...mode },
          learnerContext: 'A simulated record',
          model,
        },
        stepContext([]),
      ),
    ).rejects.toThrow('Learner Context is only supported for classic outline generation');
    expect(mocks.streamLLM).not.toHaveBeenCalled();
    expect(mocks.capabilities).not.toHaveBeenCalled();
  });

  it('retries an empty answer, reporting each retry, and then fails with the last error', async () => {
    streams('');
    const events: OutlineEvent[] = [];
    await expect(generateOutlines({ ...body, model }, stepContext(events))).rejects.toThrow(
      new OutlineGenerationError('LLM returned empty response'),
    );
    expect(mocks.streamLLM).toHaveBeenCalledTimes(3);
    expect(events).toEqual([
      { type: 'retry', attempt: 1, maxAttempts: 3 },
      { type: 'retry', attempt: 2, maxAttempts: 3 },
    ]);
  });

  it('recovers on a retry after an empty answer', async () => {
    streams('', OUTLINE_TEXT);
    const events: OutlineEvent[] = [];
    const result = await generateOutlines({ ...body, model }, stepContext(events));
    expect(events[0]).toEqual({ type: 'retry', attempt: 1, maxAttempts: 3 });
    expect(result.outlines).toHaveLength(2);
  });

  it('stops without retrying once the caller goes away', async () => {
    const controller = new AbortController();
    controller.abort();
    streams(OUTLINE_TEXT);
    await expect(
      generateOutlines({ ...body, model }, stepContext([], controller.signal)),
    ).rejects.toBeInstanceOf(StepAbortedError);
    expect(mocks.streamLLM).toHaveBeenCalledTimes(1);
  });

  it('keeps media out of the prompt when the caller opts out, whatever the slots offer', async () => {
    mocks.capabilities.mockResolvedValue({
      webSearch: false,
      imageGeneration: true,
      videoGeneration: true,
      tts: false,
    });
    streams(OUTLINE_TEXT);
    await generateOutlines({ ...body, model }, stepContext([]));
    const offered = (mocks.streamLLM.mock.calls[0]![0] as { system: string }).system;

    mocks.streamLLM.mockClear();
    streams(OUTLINE_TEXT);
    await generateOutlines(
      { ...body, model, allowImageGeneration: false, allowVideoGeneration: false },
      stepContext([]),
    );
    const optedOut = (mocks.streamLLM.mock.calls[0]![0] as { system: string }).system;
    expect(optedOut).not.toEqual(offered);
  });
});
