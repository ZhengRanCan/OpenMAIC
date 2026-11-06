import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readDialogueSource } from '@/lib/persistence/dialogue-trace-read';
import { LearnerMastery } from '@/lib/server/learner-mastery';
import { dialogueEvidenceFixture, model, reply } from './dialogue-evidence-fixture';

const url = process.env.PG_CONTRACT_URL;
const target = {
  id: 'run:target:1',
  revision: 1,
  statement: '给定以 kg 表示的质量和以 cm³ 表示的体积，独立写出换算、密度列式、结果和单位。',
};
const locator = { ownerId: 'owner', runId: 'run', targetId: target.id, targetRevision: 1 };
const unverified = ['独立完成 kg 到 g 的换算并列式求密度'];
type Fixture = Awaited<ReturnType<typeof dialogueEvidenceFixture>>;

function synthesis(assistance: 'assisted' | 'independent') {
  return vi.fn(async (_system: string, user: string) => {
    const { evidence } = JSON.parse(user);
    const evidenceRef = evidence[0].evidenceRef;
    const assisted = assistance === 'assisted';
    return JSON.stringify({
      assessments: [
        {
          evidenceRef,
          coverage: assisted ? 'partial' : 'direct',
          result: 'correct',
          assistance,
          observation: assisted
            ? '老师给出 480 g 后，学生算得 12 g/cm³。'
            : '学生独立换算 1.2 kg，列式并算得 3 g/cm³。',
        },
      ],
      candidateState: {
        summary: assisted
          ? '老师给出换算后算对。'
          : '先在老师给出换算后算对，后在新题中独立完成全过程。',
        unverified: assisted ? unverified : [],
        adoptedEvidenceRefs: [evidenceRef],
      },
    });
  });
}

describe.skipIf(!url)('F80 course target Mastery in PostgreSQL', () => {
  let f: Fixture;
  let service: LearnerMastery;
  beforeEach(async () => {
    f = await dialogueEvidenceFixture(url!);
    await f.db.query("UPDATE generation_runs SET outline=$1, outline_revision=1 WHERE id='run'", [
      JSON.stringify({ outlines: [{ id: 'scene', type: 'slide' }], targets: [target] }),
    ]);
    service = new LearnerMastery(f.provider, f.settings);
  });
  afterEach(async () => f?.close());

  async function saveEvidence(independent = false, question = false) {
    const chatSessionId = independent ? 'new-problem' : 'assisted-problem';
    const student = question
      ? '为什么先把千克换成克？'
      : independent
        ? '1.2 kg = 1200 g，ρ = 1200÷400 = 3 g/cm³。'
        : '480÷40=12 g/cm³。';
    await f.save({
      ...f.chat,
      id: chatSessionId,
      type: 'discussion',
      messages: [
        {
          id: 't',
          role: 'assistant',
          parts: [
            {
              type: 'text',
              text: independent
                ? '独立完成：质量 1.2 kg、体积 400 cm³，求密度。'
                : '质量已换算为 480 g，体积为 40 cm³，求密度。',
            },
          ],
        },
        { id: 's', role: 'user', parts: [{ type: 'text', text: student }] },
      ],
    });
    const source = await readDialogueSource(f.provider, 'owner', {
      stageId: 'stage',
      chatSessionId,
    });
    if (source.status !== 'available') throw new Error(source.status);
    f.settings.bindings.push({
      ...f.settings.bindings[0]!,
      chatSessionId,
      sourceDigest: source.source.contentDigest,
    });
    const run = await f.store.prepare(
      'owner',
      { ...f.request(), chatSessionId },
      f.settings,
      model,
    );
    const claim = await f.store.claim('owner', run.id, f.settings);
    if (!claim) throw new Error('Missing extraction claim');
    await f.store.capture(
      'owner',
      claim,
      {
        ...reply,
        text: JSON.stringify({
          facts: [
            {
              type: question ? 'question_help' : 'learning_performance',
              evidence: student,
              refs: ['t', 's'],
            },
          ],
        }),
      },
      f.settings,
    );
    const saved = await f.store.finalize('owner', run.id);
    expect(saved.state).toBe('completed');
    return saved.id;
  }

  it('skips empty inputs and retains assisted observations when independent work closes the gap', async () => {
    const assisted = synthesis('assisted');
    expect(await service.maintain(locator, [], assisted)).toBeNull();
    expect(assisted).not.toHaveBeenCalled();
    expect(await service.read(locator)).toBeNull();
    expect((await f.db.query('SELECT 1 FROM generation_target_mastery')).rowCount).toBe(0);

    const first = await saveEvidence();
    const before = await service.maintain(locator, [first], assisted);
    expect(before).toMatchObject({
      learnerId: 'simulated-A',
      target,
      state: { unverified, observations: [{ assistance: 'assisted' }] },
    });
    expect(await service.maintain(locator, [first, first], assisted)).toEqual(before);
    expect(assisted).toHaveBeenCalledTimes(1);

    const second = await saveEvidence(true);
    const independent = synthesis('independent');
    const after = await service.maintain(locator, [first, second], independent);
    expect(JSON.parse(independent.mock.calls[0]![1])).toMatchObject({
      previous: before?.state,
      evidence: [{ messages: [{ role: 'agent' }, { role: 'student' }] }],
    });
    expect(after?.state.unverified).toEqual([]);
    expect(after?.state.observations).toEqual([
      before?.state.observations[0],
      expect.objectContaining({ coverage: 'direct', assistance: 'independent' }),
    ]);
    expect(await new LearnerMastery(f.provider, f.settings).read(locator)).toEqual(after);
  });

  it('fences concurrent invocation and retains an unknown outcome without redispatch', async () => {
    const run = await saveEvidence();
    let started!: () => void;
    let release!: () => void;
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const modelCall = vi.fn(async () => {
      started();
      await gate;
      throw new Error('provider unknown');
    });
    const first = service.maintain(locator, [run], modelCall);
    const expected = expect(first).rejects.toThrow('provider unknown');
    await entered;
    try {
      await expect(service.maintain(locator, [run], modelCall)).rejects.toThrow(
        'MASTERY_INVOCATION_PENDING_OR_UNKNOWN',
      );
    } finally {
      release();
      await expected;
    }
    await expect(service.maintain(locator, [run], modelCall)).rejects.toThrow(
      'MASTERY_INVOCATION_PENDING_OR_UNKNOWN',
    );
    expect(modelCall).toHaveBeenCalledTimes(1);
    expect(await service.read(locator)).toBeNull();
  });

  it('recovers a captured candidate after the final transaction fails', async () => {
    const run = await saveEvidence();
    let transactions = 0;
    const failing = new LearnerMastery(
      {
        withTransaction: (body) =>
          f.provider.withTransaction(async (tx) => {
            const transaction = ++transactions;
            const value = await body(tx);
            if (transaction === 3) throw new Error('final commit failed');
            return value;
          }),
      },
      f.settings,
    );
    const generate = synthesis('assisted');
    await expect(failing.maintain(locator, [run], generate)).rejects.toThrow('final commit failed');
    expect(await service.read(locator)).toBeNull();
    const second = await saveEvidence(true);
    const independent = synthesis('independent');
    expect(await service.maintain(locator, [run, second], independent)).toMatchObject({
      state: {
        unverified: [],
        observations: [{ assistance: 'assisted' }, { assistance: 'independent' }],
      },
    });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(independent).toHaveBeenCalledTimes(1);
  });

  it('refuses mismatched identity, revoked bindings, and untrusted model references', async () => {
    const run = await saveEvidence();
    const generate = synthesis('assisted');
    await expect(
      service.maintain({ ...locator, ownerId: 'other' }, [run], generate),
    ).rejects.toThrow('MASTERY_COURSE_UNAVAILABLE');
    const invalid = vi.fn(async () =>
      JSON.stringify({
        assessments: [
          {
            evidenceRef: 'invented',
            coverage: 'direct',
            result: 'correct',
            assistance: 'independent',
            observation: 'invented',
          },
        ],
        candidateState: null,
      }),
    );
    await expect(service.maintain(locator, [run], invalid)).rejects.toThrow(
      'MASTERY_INVALID_ASSESSMENT',
    );
    expect(await service.read(locator)).toBeNull();
    expect(await service.maintain(locator, [run], generate)).not.toBeNull();
    f.settings.bindings.pop();
    await expect(service.read(locator)).rejects.toThrow('MASTERY_SOURCE_UNAVAILABLE');
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('keeps a relevant question as ungraded context with the target still unverified', async () => {
    const run = await saveEvidence(false, true);
    const context = (gaps: string[]) => async (_system: string, user: string) => {
      const evidenceRef = JSON.parse(user).evidence[0].evidenceRef;
      return JSON.stringify({
        assessments: [
          {
            evidenceRef,
            coverage: 'context',
            result: 'ungraded',
            assistance: 'unknown',
            observation: '学生询问为什么换算。',
          },
        ],
        candidateState: {
          summary: '只有求助。',
          unverified: gaps,
          adoptedEvidenceRefs: [evidenceRef],
        },
      });
    };
    await expect(service.maintain(locator, [run], context([]))).rejects.toThrow(
      'MASTERY_UNVERIFIED_REQUIRED',
    );
    expect(await service.maintain(locator, [run], context(unverified))).toMatchObject({
      state: {
        unverified,
        observations: [{ coverage: 'context', result: 'ungraded', assistance: 'unknown' }],
      },
    });
  });
});
