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
function streams(...texts: Array<string | string[]>) {
  let call = 0;
  mocks.streamLLM.mockImplementation(() => {
    const text = texts[Math.min(call++, texts.length - 1)]!;
    return {
      fullStream: (async function* () {
        // Split the answer so the outlines are parsed incrementally.
        const middle = Math.floor(text.length / 2);
        const chunks = Array.isArray(text) ? text : [text.slice(0, middle), text.slice(middle)];
        for (const chunk of chunks) {
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

  it('passes accepted objectives to the user prompt without changing the scene output schema', async () => {
    const courseObjectives = {
      courseObjective: 'Add fractions with unlike denominators.',
      targetStatements: ['Find a common denominator.', 'Add the converted fractions.'],
    };
    // A stray target-shaped field from the scene model never overrides accepted objectives.
    streams(OUTLINE_TEXT.replace(/}$/, ',"targetStatements":["Unrelated target"]}'));
    const result = await generateOutlines({ ...body, model, courseObjectives }, stepContext([]));
    const original = buildOutlinePrompt(body.requirements);
    expect(mocks.streamLLM.mock.calls[0]![0]).toMatchObject({
      system: original.system,
      prompt: expect.stringContaining(original.user),
    });
    expect(mocks.streamLLM.mock.calls[0]![0].prompt).toContain(JSON.stringify(courseObjectives));
    expect(result.outlines).toHaveLength(2);
    expect(result).not.toHaveProperty('targetStatements');
  });

  it('streams scenes only from the top-level outlines array', async () => {
    streams(
      JSON.stringify({
        context: { outlines: [{ id: 'not-a-scene', type: 'slide', title: 'Ignore' }] },
        ...JSON.parse(OUTLINE_TEXT),
      }),
    );
    const result = await generateOutlines({ ...body, model }, stepContext([]));
    expect(result.outlines.map(({ id }) => id)).toEqual(['o1', 'o2']);
  });

  it('accepts a legacy array without adding a target field', async () => {
    streams(JSON.stringify(JSON.parse(OUTLINE_TEXT).outlines));
    const result = await generateOutlines({ ...body, model }, stepContext([]));
    expect(result.outlines).toHaveLength(2);
    expect(result).not.toHaveProperty('targetStatements');
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

  it.each([false, true])(
    'passes formal Memory and Mastery to outlines with interactive=%s',
    async (interactiveMode) => {
      streams(OUTLINE_TEXT, OUTLINE_TEXT);
      const requirements = { ...body.requirements, interactiveMode };
      const courseObjectives = {
        courseObjective: '能计算密度并换算单位。',
        targetStatements: ['用给定质量和体积计算密度。', '在 g/cm³ 和 kg/m³ 间换算。'],
      };
      const profileLearnerMemory = [
        {
          text: '有公式提示时算出 2.7 g/cm³。',
          section: 'experiences' as const,
          source: 'discussion' as const,
          conditions: [{ help: 'prior-teacher-messages' as const }],
        },
        {
          text: '在帮助条件未知的换算题中选对了结果。',
          section: 'experiences' as const,
          source: 'quiz' as const,
          conditions: [{ help: 'unknown' as const, review: 'correct' as const }],
        },
      ];
      const profileLearnerMastery = [
        {
          target: { statement: '在常用单位之间换算。' },
          summary: '在公式提示下完成计算，独立换算待核。',
          observations: [],
          unverified: ['独立换算。'],
        },
      ];
      await generateOutlines({ ...body, requirements, courseObjectives, model }, stepContext([]));
      await generateOutlines(
        {
          ...body,
          requirements,
          courseObjectives,
          profileLearnerMemory,
          profileLearnerMastery,
          model,
        },
        stepContext([]),
      );
      const control = mocks.streamLLM.mock.calls[0]![0];
      const personalized = mocks.streamLLM.mock.calls[1]![0];
      if (interactiveMode) {
        expect(control.system).toContain('Interactive Mode Outline Generator');
        expect(control.system).toContain('Use a standard `quiz` scene for scored checks');
        expect(control.system).toContain('use a `slide` with a planned Discussion');
        expect(control.system).toContain('Reserve the solution and task-specific hints');
      } else {
        expect(control.system).toContain('Independent process checks');
      }
      expect(personalized.system).toBe(control.system);
      expect(personalized.prompt.startsWith(control.prompt)).toBe(true);
      expect(control.prompt).not.toContain('## Selected learner Memory');
      expect(personalized.prompt).toContain(
        'The current classroom request and materials take priority',
      );
      expect(personalized.prompt).toContain(
        JSON.stringify([
          profileLearnerMemory[0],
          {
            ...profileLearnerMemory[1],
            text: '在换算题中选对了结果。',
            conditions: [{ review: 'correct' }],
          },
        ]),
      );
      expect(personalized.prompt).not.toContain('"help":"unknown"');
      expect(personalized.prompt).not.toContain('帮助条件未知');
      expect(personalized.prompt).toContain('## Learner Mastery');
      expect(personalized.prompt).toContain(JSON.stringify(profileLearnerMastery));
      expect(control.prompt).not.toContain('## Learner Mastery');
      expect(control.prompt).toContain('## Accepted course objectives');
      expect(control.prompt).toContain(JSON.stringify(courseObjectives));
      expect(personalized.prompt).toContain(JSON.stringify(courseObjectives));
    },
  );

  it('renders Mastery separately from Memory without replacing the current request', async () => {
    streams(OUTLINE_TEXT);
    const learnerMastery = [
      {
        target: { id: 'old-target', revision: 1, statement: 'Show common-denominator addition.' },
        summary: 'Completed one step with help.',
        unverified: ['Show the full independent process.'],
        observations: [],
      },
    ];
    await generateOutlines(
      {
        ...body,
        learnerContext: 'Prefers diagrams.',
        courseObjectives: {
          courseObjective: 'Use fractions.',
          targetStatements: ['Add fractions.'],
        },
        learnerMastery,
        model,
      },
      stepContext([]),
    );
    const prompt = mocks.streamLLM.mock.calls[0]![0].prompt;
    expect(prompt).toContain(body.requirements.requirement);
    expect(prompt).toContain('Prefers diagrams.\n\n## Accepted course objectives');
    expect(prompt).toContain('Add fractions.');
    expect(prompt).toContain('## Learner Mastery');
    expect(prompt).toContain('The current classroom request takes priority');
    expect(prompt).toContain(JSON.stringify(learnerMastery));
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

  it('carries attribution boundaries and the unchanged accurate history into the actual outline model request', async () => {
    streams(OUTLINE_TEXT);
    const learnerContext =
      '教师先给0.6kg=600g，学生只算600÷30=20并自报不能独立换算；教师随后讲右移三位并让试算，未见后续学生回复。\n条件：隔离代理记录。';
    await generateOutlines({ ...body, learnerContext, model }, stepContext([]));
    expect(mocks.streamLLM).toHaveBeenCalledTimes(1);
    const request = mocks.streamLLM.mock.calls[0]![0] as { system: string; prompt: string };
    expect(request.prompt).toBe(buildOutlinePrompt(body.requirements, { learnerContext }).user);
    expect(request.prompt.endsWith(learnerContext)).toBe(true);
    for (const rule of [
      'teacher-provided values or results',
      'not a conversion completed by the student',
      'Preserve chronology',
      'An unanswered later request',
      'Even "completed with help"',
      'Keep historical recall separate from planned teaching',
      'omit the recall',
    ])
      expect(request.prompt).toContain(rule);
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
