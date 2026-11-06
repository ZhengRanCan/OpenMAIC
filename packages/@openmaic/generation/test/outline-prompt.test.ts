// Behavior-parity golden guard for prompt construction in lib/generation/outline-generator.ts.
import { describe, expect, test, vi } from 'vitest';
import {
  buildOutlinePrompt,
  generateSceneActions,
  generateSceneOutlinesFromRequirements,
} from '@openmaic/generation';

test('passes an independent process check to the existing Discussion action generator', async () => {
  const topic = '质量为 1.2 kg、体积为 400 cm³，求密度。';
  const prompt = '请提交换算、列式、结果和单位。先等待学生作答。';
  const planner = buildOutlinePrompt({ requirement: '检查学生能否独立完成密度计算。' });
  expect(planner.system).toContain('Independent process checks');

  const aiCall = vi.fn(async (system: string, user: string) => {
    expect(system).toContain('Independent process check');
    expect(user).toContain(topic);
    expect(user).toContain(prompt);
    return JSON.stringify([
      { type: 'text', content: '请先独立完成新题。' },
      { type: 'action', name: 'discussion', params: { topic, prompt, agentId: 'teacher' } },
    ]);
  });
  const actions = await generateSceneActions(
    {
      id: 'density',
      type: 'slide',
      title: '独立验证',
      description: topic,
      keyPoints: [prompt],
      order: 5,
    },
    { elements: [] },
    aiCall,
    { agents: [{ id: 'teacher', name: 'Teacher', role: 'teacher', persona: 'Physics teacher' }] },
  );
  expect(aiCall).toHaveBeenCalledOnce();
  expect(actions.map((action) => action.type)).toEqual(['speech', 'discussion']);
  expect(actions.at(-1)).toMatchObject({ type: 'discussion', topic, prompt, agentId: 'teacher' });
});

describe('buildOutlinePrompt golden output', () => {
  test('pins every conditional off', () => {
    expect(
      buildOutlinePrompt(
        { requirement: 'Teach recursion to beginners' },
        { researchContext: '', teacherContext: '' },
      ),
    ).toMatchSnapshot();
  });

  test('pins every conditional on', () => {
    expect(
      buildOutlinePrompt(
        {
          requirement: '用中文讲解光合作用',
          userNickname: 'Lin',
          userBio: 'Middle-school learner',
        },
        {
          pdfText: 'Source notes about chlorophyll.',
          pdfImages: [
            {
              id: 'img_2',
              src: '',
              pageNumber: 2,
              width: 800,
              height: 600,
              description: 'Leaf cross-section',
              sourceDocumentName: 'biology.pdf',
              visionPriority: 3,
            },
          ],
          visionEnabled: true,
          imageMapping: { img_2: 'data:image/png;base64,AAAA' },
          imageGenerationEnabled: true,
          videoGenerationEnabled: true,
          researchContext: 'A current source summary.',
          teacherContext: 'Teacher Persona:\nUse a Socratic style.',
        },
      ),
    ).toMatchSnapshot();
  });

  test('pins image and media conditionals on with video off', () => {
    expect(
      buildOutlinePrompt(
        { requirement: 'Explain the water cycle with generated diagrams' },
        {
          imageGenerationEnabled: true,
          videoGenerationEnabled: false,
        },
      ),
    ).toMatchSnapshot();
  });

  test('pins source-image conditionals on with generated media off', () => {
    expect(
      buildOutlinePrompt(
        { requirement: 'Explain the labeled anatomy diagram' },
        {
          pdfImages: [
            {
              id: 'source_1',
              src: '',
              pageNumber: 4,
              width: 1200,
              height: 900,
              description: 'Labeled cross-section of a plant cell',
              sourceDocumentName: 'cell-biology.pdf',
            },
          ],
          imageGenerationEnabled: false,
          videoGenerationEnabled: false,
        },
      ),
    ).toMatchSnapshot();
  });

  test('keeps absent and empty Learner Context byte-identical to the old prompt', () => {
    const requirements = {
      requirement: 'Teach density',
      userNickname: 'Lin',
      userBio: 'Middle-school learner',
    };
    const original = buildOutlinePrompt(requirements);
    for (const learnerContext of [undefined, '', ' \n ']) {
      expect(buildOutlinePrompt(requirements, { learnerContext })).toEqual(original);
    }
    expect(original.user).toContain('## Student Profile');
    expect(original.user).not.toContain('## Learner Context');
  });

  test('adds the selected records verbatim in a separate slot with current requirements first', () => {
    const requirements = {
      requirement: 'Use direct practice today, even when a prior record prefers examples.',
      userNickname: 'Browser nickname',
      userBio: 'Unrelated browser bio',
    };
    const learnerContext =
      '  密度换算经历：在给出公式与单位换算提示后完成。\n条件：只记录这次有提示的作答。\n持续要求：数学课先举例。  ';
    const prompts = buildOutlinePrompt(requirements, { learnerContext });
    const original = buildOutlinePrompt({ requirement: requirements.requirement });
    expect(prompts.system).toBe(original.system);
    expect(prompts.user.startsWith(original.user)).toBe(true);
    expect(prompts.user).toContain('## Learner Context');
    expect(prompts.user).toContain("Follow this session's explicit requirements first.");
    expect(prompts.user).toContain('specific experiences do not establish long-term mastery');
    expect(prompts.user.endsWith(learnerContext)).toBe(true);
    expect(prompts.user).not.toContain('## Student Profile');
    expect(prompts.user).not.toContain('Browser nickname');
    expect(prompts.user).not.toContain('Unrelated browser bio');
    expect(requirements.userBio).toBe('Unrelated browser bio');
  });

  test.each([{ interactiveMode: true }, { taskEngineMode: true }])(
    'rejects Learner Context for unsupported mode %j',
    (mode) => {
      expect(() =>
        buildOutlinePrompt(
          { requirement: 'Teach density', ...mode },
          { learnerContext: 'A simulated record' },
        ),
      ).toThrow('Learner Context is only supported for classic outline generation');
      expect(() => buildOutlinePrompt({ requirement: 'Teach density', ...mode })).not.toThrow();
    },
  );

  test('separates teacher help, observed student work and future plans when supplying historical records', () => {
    const learnerContext =
      '教师先给0.6kg=600g，学生只算600÷30=20并自报不能独立换算；教师随后讲右移三位并让试算，未见后续学生回复。';
    const requirements = { requirement: 'Plan the next density lesson.' };
    const prompts = buildOutlinePrompt(requirements, { learnerContext });
    for (const rule of [
      'teacher-provided values or results',
      'not a conversion completed by the student',
      '600 g divided by 30',
      'Preserve chronology',
      'An unanswered later request',
      'Even "completed with help"',
      'Keep historical recall separate from planned teaching',
      'omit the recall',
    ])
      expect(prompts.user).toContain(rule);
    expect(prompts.user.endsWith(learnerContext)).toBe(true);
    expect(prompts.system).toBe(buildOutlinePrompt(requirements).system);
    expect(buildOutlinePrompt(requirements).user).not.toContain('Historical attribution rules');
  });

  test('passes Learner Context to the model call through the generation API', async () => {
    const learnerContext = '经历原文\n条件：给出公式后。';
    const aiCall = vi.fn().mockResolvedValue(
      JSON.stringify({
        outlines: [{ type: 'slide', title: 'Density', description: 'd', keyPoints: ['units'] }],
      }),
    );
    const result = await generateSceneOutlinesFromRequirements(
      { requirement: 'Teach density' },
      undefined,
      undefined,
      aiCall,
      { learnerContext },
    );
    expect(result.success).toBe(true);
    expect(aiCall).toHaveBeenCalledExactlyOnceWith(
      buildOutlinePrompt({ requirement: 'Teach density' }).system,
      buildOutlinePrompt({ requirement: 'Teach density' }, { learnerContext }).user,
      undefined,
    );
  });
});
