import { describe, expect, it, vi } from 'vitest';
import { emptySnapshot, versionSource, type MemoryPiece } from '@/lib/learner-memory/contracts';
import { projectMemory } from '@/lib/learner-memory/read';
import {
  assertPreclassContextCurrent,
  buildPreclassLearnerContext,
  renderPreclassLearnerContext,
  type PreclassMemoryRead,
} from '@/lib/server/preclass-learner-context';

function fixture(): PreclassMemoryRead {
  const support = versionSource({
    id: 'sim:B:density',
    kind: 'quiz_evidence',
    text: '密度题作答记录',
    refs: ['quiz:density:attempt-1'],
    conditions: ['题目提供公式与单位换算提示'],
    sourceNature: 'synthetic',
    occurredAt: null,
    provenance: {
      file: 'private-seed.json',
      sha256: 'a'.repeat(64),
      pointer: '/source/density',
    },
  });
  const piece: MemoryPiece = {
    id: 'piece:density',
    text: '在公式与换算提示下完成密度计算。\n尚无独立解题记录。',
    formation: 'synthesis',
    supports: [support],
    conditions: ['仅限本次具体题目'],
    restrictions: [],
  };
  const snapshot = emptySnapshot();
  snapshot.revision = 3;
  snapshot.pieces = [piece];
  snapshot.sections.learning_experiences = [piece.id];
  return {
    scope: { namespace: 'f67-test:unit', learnerKey: 'sim-b' },
    snapshot,
    usable: projectMemory(snapshot),
    sections: {
      background: [],
      goals: [],
      teaching_requirements: [],
      learning_experiences: [piece],
    },
    markdown: 'AUDIT MARKDOWN MUST NOT ENTER PROMPT',
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

const input = {
  student: 'B' as const,
  task: '本次用密度题练习单位换算',
  content: { pdfText: '密度与质量', researchContext: '课程提供的材料摘录' },
};
const selectedReply = JSON.stringify({
  selected: [{ pieceId: 'piece:density', reason: '本任务涉及单位换算' }],
});

describe('preclass learner context binding', () => {
  it('uses formal sections, freezes original text and full sources, and minimizes model projections', async () => {
    const view = fixture();
    // Audit-only text must not become a candidate even if it exists in snapshot/usable.pieces.
    view.snapshot.pieces.push({
      ...structuredClone(view.snapshot.pieces[0]),
      id: 'audit-only',
      text: '不可选审计正文',
    });
    const select = vi.fn().mockResolvedValue(selectedReply);
    const context = await buildPreclassLearnerContext(input, { read: async () => view, select });
    expect(context).toMatchObject({ status: 'ready', student: 'B', memoryRevision: 3 });
    expect(context.selected[0]).toMatchObject({
      pieceId: 'piece:density',
      text: view.sections.learning_experiences[0].text,
      formation: 'synthesis',
      conditions: ['仅限本次具体题目'],
      supports: view.sections.learning_experiences[0].supports,
    });
    const prompt = select.mock.calls[0][0];
    expect(prompt.inputBytes).toBe(Buffer.byteLength(prompt.system + prompt.user, 'utf8'));
    expect(prompt.user).toContain(input.task);
    expect(prompt.user).toContain('题目提供公式与单位换算提示');
    expect(prompt.user).not.toContain('不可选审计正文');
    expect(prompt.user).not.toContain('AUDIT MARKDOWN');
    expect(prompt.user).not.toContain('private-seed.json');
    expect(prompt.user).not.toContain(view.coverage[0].version);
    view.sections.learning_experiences[0].supports[0].conditions.push('之后修改');
    expect(context.selected[0].supports[0].conditions).not.toContain('之后修改');

    const rendered = renderPreclassLearnerContext(context);
    expect(rendered.startsWith(context.selected[0].text)).toBe(true);
    expect(rendered).toContain('仅限本次具体题目');
    expect(rendered).toContain('题目提供公式与单位换算提示');
    expect(rendered).toContain('quiz:density:attempt-1');
    expect(rendered).not.toContain('private-seed.json');
    expect(rendered).not.toContain(context.selected[0].supports[0].version);
    expect(rendered).not.toContain('本任务涉及单位换算');
  });

  it('records empty without invoking selection and no_relevant when selector chooses nothing', async () => {
    const view = fixture();
    view.sections.learning_experiences = [];
    const select = vi.fn().mockResolvedValue('{"selected":[]}');
    const empty = await buildPreclassLearnerContext(
      { ...input, student: 'A' },
      { read: async () => view, select },
    );
    expect(empty.status).toBe('empty');
    expect(select).not.toHaveBeenCalled();
    expect(renderPreclassLearnerContext(empty)).toBe('');
    const irrelevant = await buildPreclassLearnerContext(input, {
      read: async () => fixture(),
      select,
    });
    expect(irrelevant.status).toBe('no_relevant');
    expect(renderPreclassLearnerContext(irrelevant)).toBe('');
    expect(select).toHaveBeenCalledTimes(1);
  });

  it.each([
    'invalid JSON',
    '```json\n{"selected":[]}\n```',
    '{"selected":[],"strategy":"teach density"}',
    '{"selected":[{"pieceId":"piece:density","reason":"relevant","text":"rewrite"}]}',
    '{"selected":[{"pieceId":"unknown","reason":"relevant"}]}',
    '{"selected":[{"pieceId":"piece:density","reason":"  "}]}',
    JSON.stringify({
      selected: [
        { pieceId: 'piece:density', reason: 'one' },
        { pieceId: 'piece:density', reason: 'two' },
      ],
    }),
    JSON.stringify({ selected: [{ pieceId: 'piece:density', reason: 'x'.repeat(1001) }] }),
    ' '.repeat(24001),
  ])('rejects malformed, invented, repeated or over-budget selection: %s', async (reply) => {
    const select = vi.fn().mockResolvedValue(reply);
    await expect(
      buildPreclassLearnerContext(input, { read: async () => fixture(), select }),
    ).rejects.toMatchObject({ code: 'LEARNER_CONTEXT_SELECTION_INVALID' });
    expect(select).toHaveBeenCalledTimes(1);
  });

  it('checks input capacity before selection, propagates failures and never retries', async () => {
    const select = vi.fn().mockRejectedValue(new Error('selector failed'));
    await expect(
      buildPreclassLearnerContext(
        { ...input, task: '中'.repeat(17000) },
        { read: async () => fixture(), select },
      ),
    ).rejects.toMatchObject({ code: 'LEARNER_CONTEXT_INPUT_CAPACITY_EXCEEDED' });
    expect(select).not.toHaveBeenCalled();
    await expect(
      buildPreclassLearnerContext(input, { read: async () => fixture(), select }),
    ).rejects.toThrow('selector failed');
    expect(select).toHaveBeenCalledTimes(1);
    const read = vi.fn().mockRejectedValue(new Error('database unavailable'));
    await expect(buildPreclassLearnerContext(input, { read, select })).rejects.toThrow(
      'database unavailable',
    );
    expect(select).toHaveBeenCalledTimes(1);
  });

  it.each(['maintenance', 'restricted', 'invalid-source'] as const)(
    'blocks %s before exposing candidates to selector',
    async (state) => {
      const view = fixture();
      if (state === 'maintenance') view.maintenancePending = true;
      if (state === 'restricted')
        view.usable.restricted.push({ id: 'restricted', reasons: ['source withdrawn'] });
      if (state === 'invalid-source') view.coverage[0].valid = false;
      const select = vi.fn().mockResolvedValue(selectedReply);
      await expect(
        buildPreclassLearnerContext(input, { read: async () => view, select }),
      ).rejects.toMatchObject({ code: 'LEARNER_MEMORY_RECHECK_REQUIRED' });
      expect(select).not.toHaveBeenCalled();
    },
  );

  it('binds task and material fingerprints independently of object key ordering', async () => {
    const deps = { read: async () => fixture(), select: async () => selectedReply };
    const context = await buildPreclassLearnerContext(input, deps);
    const reordered = await buildPreclassLearnerContext(
      {
        ...input,
        content: { researchContext: input.content.researchContext, pdfText: input.content.pdfText },
      },
      deps,
    );
    expect(reordered.contentDigest).toBe(context.contentDigest);
    const changed = await buildPreclassLearnerContext({ ...input, task: '改为复习' }, deps);
    expect(changed.taskDigest).not.toBe(context.taskDigest);
    expect(changed.contentDigest).toBe(context.contentDigest);
  });

  it('selects a trusted piece supported by a still-valid historical source version', async () => {
    const view = fixture();
    view.coverage[0].current = false;
    const context = await buildPreclassLearnerContext(input, {
      read: async () => view,
      select: async () => selectedReply,
    });
    expect(context.status).toBe('ready');
    expect(context.selected[0].supports[0].version).toBe(view.coverage[0].version);
  });
});

describe('frozen learner context freshness', () => {
  async function context() {
    return buildPreclassLearnerContext(input, {
      read: async () => fixture(),
      select: async () => selectedReply,
    });
  }

  it('keeps frozen context across ordinary revisions and pending new evidence', async () => {
    const frozen = await context();
    const view = fixture();
    view.usable.revision = 8;
    view.sections.learning_experiences = [];
    view.coverage.push({
      source_id: 'new-unprocessed',
      version: 'b'.repeat(64),
      current: true,
      valid: true,
      processed: false,
    });
    await expect(
      assertPreclassContextCurrent(frozen, { read: async () => view }),
    ).resolves.toBeUndefined();
    expect(frozen.memoryRevision).toBe(3);
    expect(frozen.selected[0].text).toBe(fixture().sections.learning_experiences[0].text);
  });

  it('retains a frozen dependency when its exact historical version remains valid', async () => {
    const frozen = await context();
    const view = fixture();
    view.coverage[0].current = false;
    view.coverage.push({
      ...view.coverage[0],
      version: 'b'.repeat(64),
      current: true,
    });
    await expect(
      assertPreclassContextCurrent(frozen, { read: async () => view }),
    ).resolves.toBeUndefined();
    expect(frozen.selected[0].supports[0].version).toBe(view.coverage[0].version);
  });

  it.each(['missing', 'invalid', 'same-id-new-version', 'maintenance', 'restricted'] as const)(
    'rejects frozen source state %s even with unchanged revision',
    async (state) => {
      const frozen = await context();
      const view = fixture();
      if (state === 'missing') view.coverage = [];
      if (state === 'invalid') view.coverage[0].valid = false;
      if (state === 'same-id-new-version') view.coverage[0].version = 'b'.repeat(64);
      if (state === 'maintenance') view.maintenancePending = true;
      if (state === 'restricted')
        view.usable.restricted.push({ id: 'restricted', reasons: ['source changed'] });
      await expect(
        assertPreclassContextCurrent(frozen, { read: async () => view }),
      ).rejects.toMatchObject({ code: 'LEARNER_MEMORY_RECHECK_REQUIRED' });
    },
  );
});
