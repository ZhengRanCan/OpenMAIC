import { describe, expect, it, vi } from 'vitest';
import { emptySnapshot, versionSource, type MemoryPiece } from '@/lib/learner-memory/contracts';
import { projectMemory } from '@/lib/learner-memory/read';
import type { QuizMemoryTask } from '@/lib/learner-context/quiz-contracts';
import { renderQuizLearnerContext } from '@/lib/learner-context/quiz-render';
import {
  assertQuizContextCurrent,
  buildQuizLearnerContext,
  quizTaskDigest,
} from '@/lib/server/quiz-learner-context';

function fixture() {
  const support = versionSource({
    id: 'sim:C:english',
    kind: 'confirmed_experience',
    text: '英语阅读正确经历',
    refs: ['english:reading:1'],
    conditions: ['提供词汇表'],
    sourceNature: 'synthetic',
    occurredAt: null,
    provenance: { file: 'private.json', sha256: 'a'.repeat(64), pointer: '/1' },
  });
  const piece: MemoryPiece = {
    id: 'piece:english',
    text: '在词汇表帮助下正确找出文章主旨。',
    formation: 'confirmed_experience',
    supports: [support],
    conditions: ['仅本篇短文'],
    restrictions: [],
  };
  const snapshot = emptySnapshot();
  snapshot.revision = 4;
  snapshot.pieces = [piece];
  snapshot.sections.learning_experiences = [piece.id];
  return {
    scope: { namespace: 'f67-test:unit', learnerKey: 'sim-c' },
    snapshot,
    usable: projectMemory(snapshot),
    sections: {
      background: [],
      goals: [],
      teaching_requirements: [],
      learning_experiences: [piece],
    },
    markdown: 'PRIVATE AUDIT',
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

const task: QuizMemoryTask = {
  requirement: '仅生成一道单选题，检查文章主旨',
  courseTitle: '阅读理解',
  outline: {
    id: 'quiz-2',
    order: 2,
    type: 'quiz',
    title: '主旨检查',
    description: '用新短文检查理解',
    keyPoints: ['主旨'],
    languageNote: '中文',
    quizConfig: { questionCount: 1, difficulty: 'easy', questionTypes: ['single'] },
  },
};
const input = { student: 'C' as const, sceneIndex: 1, task };
const reply = JSON.stringify({
  selected: [{ pieceId: 'piece:english', reason: '本次检查阅读主旨' }],
});

describe('quiz-specific learner context', () => {
  it('selects for this confirmed quiz and binds correct experiences without audit leakage', async () => {
    const view = fixture();
    const select = vi.fn().mockResolvedValue(reply);
    const context = await buildQuizLearnerContext(input, { read: async () => view, select });
    expect(context).toMatchObject({
      schemaVersion: 'quiz-learner-context.v1',
      promptVersion: 'quiz-memory-selection.v1',
      sceneIndex: 1,
      outlineId: 'quiz-2',
      student: 'C',
      status: 'ready',
      memoryRevision: 4,
      taskDigest: quizTaskDigest(task),
    });
    const prompt = select.mock.calls[0][0];
    expect(JSON.parse(prompt.user).task).toEqual(task);
    expect(prompt.system).toContain('Quiz');
    expect(prompt.user).toContain('提供词汇表');
    expect(prompt.inputBytes).toBe(Buffer.byteLength(prompt.system + prompt.user, 'utf8'));
    expect(prompt.user).not.toMatch(/private.json|PRIVATE AUDIT/);
    const rendered = renderQuizLearnerContext(task, context)!;
    expect(JSON.parse(rendered.task)).toEqual(task);
    expect(rendered.learner).toContain(view.sections.learning_experiences[0].text);
    expect(rendered.learner).toContain('仅本篇短文');
    expect(rendered.learner).toContain('提供词汇表');
    expect(rendered.learner).toContain('synthetic');
    expect(rendered.learner).not.toMatch(/本次检查阅读主旨|private.json|f67-test/);
    view.sections.learning_experiences[0].conditions.push('后续修改');
    expect(context.selected[0].conditions).not.toContain('后续修改');
  });

  it('does not select empty Memory and emits no generation slot for empty or irrelevant results', async () => {
    const view = fixture();
    view.sections.learning_experiences = [];
    const select = vi.fn().mockResolvedValue('{"selected":[]}');
    const empty = await buildQuizLearnerContext(input, { read: async () => view, select });
    expect(empty.status).toBe('empty');
    expect(select).not.toHaveBeenCalled();
    expect(renderQuizLearnerContext(task, empty)).toBeUndefined();
    const irrelevant = await buildQuizLearnerContext(input, {
      read: async () => fixture(),
      select,
    });
    expect(irrelevant.status).toBe('no_relevant');
    expect(renderQuizLearnerContext(task, irrelevant)).toBeUndefined();
  });

  it('uses canonical task fingerprints and distinguishes requirements and confirmed outlines', () => {
    const reordered: QuizMemoryTask = {
      outline: {
        ...task.outline,
        quizConfig: {
          questionTypes: ['single'],
          difficulty: 'easy',
          questionCount: 1,
        },
      },
      courseTitle: task.courseTitle,
      requirement: task.requirement,
    };
    expect(quizTaskDigest(reordered)).toBe(quizTaskDigest(task));
    expect(quizTaskDigest({ ...task, requirement: '另一要求' })).not.toBe(quizTaskDigest(task));
    expect(quizTaskDigest({ ...task, outline: { ...task.outline, keyPoints: ['推断'] } })).not.toBe(
      quizTaskDigest(task),
    );
  });

  it('rejects non-quiz tasks and invalid identities before any read or selection', async () => {
    const read = vi.fn(async () => fixture());
    const select = vi.fn(async () => reply);
    await expect(
      buildQuizLearnerContext(
        { ...input, task: { ...task, outline: { ...task.outline, type: 'slide' } } },
        { read, select },
      ),
    ).rejects.toMatchObject({ code: 'LEARNER_CONTEXT_TASK_INVALID' });
    await expect(
      buildQuizLearnerContext({ ...input, student: 'X' as 'C' }, { read, select }),
    ).rejects.toMatchObject({ code: 'UNKNOWN_SIMULATED_STUDENT' });
    expect(read).not.toHaveBeenCalled();
    expect(select).not.toHaveBeenCalled();
  });

  it('delegates freshness to shared support checks, tolerating revisions and rejecting invalid versions', async () => {
    const context = await buildQuizLearnerContext(input, {
      read: async () => fixture(),
      select: async () => reply,
    });
    const view = fixture();
    view.usable.revision = 9;
    await expect(
      assertQuizContextCurrent(context, { read: async () => view }),
    ).resolves.toBeUndefined();
    view.coverage[0].valid = false;
    await expect(
      assertQuizContextCurrent(context, { read: async () => view }),
    ).rejects.toMatchObject({ code: 'LEARNER_MEMORY_RECHECK_REQUIRED' });
  });
});
