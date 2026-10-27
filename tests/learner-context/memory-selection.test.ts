import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emptySnapshot, versionSource, type MemoryPiece } from '@/lib/learner-memory/contracts';
import { projectMemory } from '@/lib/learner-memory/read';
import { PreclassLearnerContextError } from '@/lib/learner-context/contracts';
import type { MemorySelectionPrompt } from '@/lib/learner-context/selection-contracts';
import type { LearnerMemoryRead } from '@/lib/server/simulated-learner-memory';
import {
  assertMemorySelectionCurrent,
  selectLearnerMemory,
} from '@/lib/server/learner-memory-selection';
import { invokeMemorySelectionModel } from '@/lib/server/learner-memory-selection-model';
import type { ResolvedModel } from '@/lib/server/resolve-model';

const mocks = vi.hoisted(() => ({ callLLM: vi.fn() }));
vi.mock('@/lib/ai/llm', () => ({ callLLM: mocks.callLLM }));

function fixture(): LearnerMemoryRead {
  const support = versionSource({
    id: 'synthetic:source',
    kind: 'quiz_evidence',
    text: '合成来源',
    refs: ['quiz:attempt'],
    conditions: ['提供公式'],
    sourceNature: 'synthetic',
    occurredAt: null,
    provenance: { file: 'synthetic.json', sha256: 'a'.repeat(64), pointer: '/source' },
  });
  const piece: MemoryPiece = {
    id: 'piece:one',
    text: '在提示下完成计算。\n无独立作答证据。',
    formation: 'synthesis',
    supports: [support],
    conditions: ['仅限本题'],
    restrictions: [],
  };
  const snapshot = emptySnapshot();
  snapshot.revision = 3;
  snapshot.pieces = [piece];
  snapshot.sections.learning_experiences = [piece.id];
  return {
    scope: { namespace: 'f67-test:selection', learnerKey: 'synthetic' },
    snapshot,
    usable: projectMemory(snapshot),
    sections: {
      background: [],
      goals: [],
      teaching_requirements: [],
      learning_experiences: [piece],
    },
    markdown: 'audit only',
    maintenancePending: false,
    coverage: [
      {
        source_id: support.id,
        version: support.version,
        current: true,
        valid: true,
        processed: true,
      },
    ],
  };
}

const prompt = { system: 'Choose IDs', user: 'task data', inputBytes: 18 };
const reply = JSON.stringify({ selected: [{ pieceId: 'piece:one', reason: 'related' }] });
const buildPrompt = vi.fn((_candidates: MemoryPiece[]): MemorySelectionPrompt => prompt);

describe('shared learner Memory selection', () => {
  beforeEach(() => vi.clearAllMocks());

  it('uses each caller task independently, only formal candidates, and binds original sources deeply', async () => {
    const view = fixture();
    view.snapshot.pieces.push({ ...view.snapshot.pieces[0], id: 'audit-only', text: 'audit only' });
    view.sections.background.push(view.sections.learning_experiences[0]);
    const select = vi.fn().mockResolvedValue(reply);
    const first = await selectLearnerMemory(view, { buildPrompt, select });
    const otherPrompt = { ...prompt, user: 'different task' };
    await selectLearnerMemory(view, { buildPrompt: () => otherPrompt, select });
    expect(buildPrompt.mock.calls[0][0].map((piece) => piece.id)).toEqual(['piece:one']);
    expect(select.mock.calls.map(([value]) => value)).toEqual([prompt, otherPrompt]);
    expect(first).toEqual({
      memoryRevision: 3,
      status: 'ready',
      selected: [
        {
          pieceId: 'piece:one',
          reason: 'related',
          text: view.sections.learning_experiences[0].text,
          formation: 'synthesis',
          conditions: ['仅限本题'],
          supports: view.sections.learning_experiences[0].supports,
        },
      ],
    });
    view.sections.learning_experiences[0].conditions.push('changed');
    view.sections.learning_experiences[0].supports[0].refs.push('changed');
    expect(first.selected[0].conditions).toEqual(['仅限本题']);
    expect(first.selected[0].supports[0].refs).toEqual(['quiz:attempt']);
  });

  it('skips prompt construction and selection for empty formal sections', async () => {
    const view = fixture();
    view.sections.learning_experiences = [];
    const select = vi.fn();
    await expect(selectLearnerMemory(view, { buildPrompt, select })).resolves.toEqual({
      memoryRevision: 3,
      status: 'empty',
      selected: [],
    });
    expect(buildPrompt).not.toHaveBeenCalled();
    expect(select).not.toHaveBeenCalled();
  });

  it('allows no relevant selection and does not retry selection failures', async () => {
    const select = vi
      .fn()
      .mockResolvedValueOnce('{"selected":[]}')
      .mockRejectedValueOnce(new Error('failed'));
    await expect(selectLearnerMemory(fixture(), { buildPrompt, select })).resolves.toMatchObject({
      status: 'no_relevant',
      selected: [],
    });
    await expect(selectLearnerMemory(fixture(), { buildPrompt, select })).rejects.toThrow('failed');
    expect(select).toHaveBeenCalledTimes(2);
  });

  it.each([
    '{"selected":[{"pieceId":"unknown","reason":"reason"}]}',
    '{"selected":[{"pieceId":"piece:one","reason":"one"},{"pieceId":"piece:one","reason":"two"}]}',
    '{"selected":[],"extra":true}',
    '```json\n{"selected":[]}\n```',
    ' '.repeat(24001),
  ])('rejects invalid selection without retry: %s', async (text) => {
    const select = vi.fn().mockResolvedValue(text);
    await expect(selectLearnerMemory(fixture(), { buildPrompt, select })).rejects.toMatchObject({
      code: 'LEARNER_CONTEXT_SELECTION_INVALID',
    });
    expect(select).toHaveBeenCalledTimes(1);
  });

  it.each(['maintenance', 'restricted', 'invalid', 'missing', 'unsupported'])(
    'blocks %s sources before exposing any candidates',
    async (state) => {
      const view = fixture();
      if (state === 'maintenance') view.maintenancePending = true;
      if (state === 'restricted')
        view.usable.restricted.push({ id: 'restricted', reasons: ['withdrawn'] });
      if (state === 'invalid') view.coverage[0].valid = false;
      if (state === 'missing') view.coverage = [];
      if (state === 'unsupported') view.sections.learning_experiences[0].supports = [];
      const select = vi.fn();
      await expect(selectLearnerMemory(view, { buildPrompt, select })).rejects.toBeInstanceOf(
        PreclassLearnerContextError,
      );
      expect(buildPrompt).not.toHaveBeenCalled();
      expect(select).not.toHaveBeenCalled();
    },
  );

  it('rechecks exact support versions independently of revision and current flag', async () => {
    const view = fixture();
    const selected = (await selectLearnerMemory(view, { buildPrompt, select: async () => reply }))
      .selected;
    view.usable.revision++;
    view.coverage[0].current = false;
    expect(() => assertMemorySelectionCurrent(view, selected)).not.toThrow();
    view.coverage[0].version = 'b'.repeat(64);
    expect(() => assertMemorySelectionCurrent(view, selected)).toThrow(
      'LEARNER_MEMORY_RECHECK_REQUIRED',
    );
  });
});

describe('shared selection model protocol', () => {
  const resolvedModel = {
    model: { id: 'caller-model' },
    modelInfo: { contextWindow: 64000 },
    serverManaged: true,
  } as unknown as ResolvedModel;
  const input = { resolvedModel, usageLabel: 'caller-task', prompt };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.callLLM.mockResolvedValue({ text: reply, finishReason: 'stop' });
  });

  it('uses the caller model and label after the durable marker with no retry or fallback', async () => {
    const order: string[] = [];
    const controller = new AbortController();
    mocks.callLLM.mockImplementation(async () => {
      order.push('call');
      return { text: reply, finishReason: 'stop' };
    });
    await expect(
      invokeMemorySelectionModel({
        ...input,
        signal: controller.signal,
        beforeSelect: async () => {
          order.push('marker');
        },
      }),
    ).resolves.toBe(reply);
    expect(order).toEqual(['marker', 'call']);
    expect(mocks.callLLM).toHaveBeenCalledExactlyOnceWith(
      {
        model: resolvedModel.model,
        system: prompt.system,
        prompt: prompt.user,
        maxOutputTokens: 2000,
        maxRetries: 0,
        abortSignal: controller.signal,
      },
      'caller-task',
      { retries: 0 },
      undefined,
      { enabled: false, serverManaged: true },
    );
  });

  it.each([{ contextWindow: 1000 }, { outputWindow: 1999 }])(
    'rejects insufficient capacity before marking: %s',
    async (modelInfo) => {
      const beforeSelect = vi.fn();
      await expect(
        invokeMemorySelectionModel({
          ...input,
          resolvedModel: {
            ...resolvedModel,
            modelInfo: { ...resolvedModel.modelInfo, ...modelInfo, id: 'caller', name: 'Caller' },
          },
          beforeSelect,
        }),
      ).rejects.toMatchObject({ code: 'LEARNER_CONTEXT_INPUT_CAPACITY_EXCEEDED' });
      expect(beforeSelect).not.toHaveBeenCalled();
      expect(mocks.callLLM).not.toHaveBeenCalled();
    },
  );

  it('does not call when durable marking fails', async () => {
    await expect(
      invokeMemorySelectionModel({
        ...input,
        beforeSelect: async () => {
          throw new Error('save failed');
        },
      }),
    ).rejects.toThrow('save failed');
    expect(mocks.callLLM).not.toHaveBeenCalled();
  });

  it.each(['length', 'error', 'unknown'])(
    'rejects a %s finish without retry',
    async (finishReason) => {
      mocks.callLLM.mockResolvedValue({ text: reply, finishReason });
      await expect(
        invokeMemorySelectionModel({ ...input, beforeSelect: async () => {} }),
      ).rejects.toMatchObject({ code: 'LEARNER_CONTEXT_SELECTION_INVALID' });
      expect(mocks.callLLM).toHaveBeenCalledTimes(1);
    },
  );

  it('sanitizes provider failures but preserves cancellation errors', async () => {
    const failure = new Error('private endpoint');
    mocks.callLLM.mockRejectedValue(failure);
    await expect(
      invokeMemorySelectionModel({ ...input, beforeSelect: async () => {} }),
    ).rejects.toThrow('LEARNER_CONTEXT_SELECTION_FAILED');
    const controller = new AbortController();
    mocks.callLLM.mockImplementationOnce(async () => {
      controller.abort();
      throw failure;
    });
    await expect(
      invokeMemorySelectionModel({
        ...input,
        signal: controller.signal,
        beforeSelect: async () => {},
      }),
    ).rejects.toBe(failure);
    expect(mocks.callLLM).toHaveBeenCalledTimes(2);
  });

  it('does not mark or invoke an already cancelled selection', async () => {
    const controller = new AbortController();
    const reason = new Error('cancelled before selection');
    controller.abort(reason);
    const beforeSelect = vi.fn();
    await expect(
      invokeMemorySelectionModel({ ...input, signal: controller.signal, beforeSelect }),
    ).rejects.toBe(reason);
    expect(beforeSelect).not.toHaveBeenCalled();
    expect(mocks.callLLM).not.toHaveBeenCalled();
  });

  it('does not invoke when cancellation occurs while persisting the call marker', async () => {
    const controller = new AbortController();
    const reason = new Error('cancelled during marker');
    const beforeSelect = vi.fn(async () => {
      controller.abort(reason);
    });
    await expect(
      invokeMemorySelectionModel({ ...input, signal: controller.signal, beforeSelect }),
    ).rejects.toBe(reason);
    expect(beforeSelect).toHaveBeenCalledTimes(1);
    expect(mocks.callLLM).not.toHaveBeenCalled();
  });
});
