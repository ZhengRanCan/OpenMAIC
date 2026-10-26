import { describe, expect, it } from 'vitest';
import { validateTransition } from '@/lib/learner-memory/transition';
import { projectMemory, renderMemory } from '@/lib/learner-memory/read';
import { runFixture, response } from './fixtures';
import { versionSource } from '@/lib/learner-memory/contracts';
import { buildMemoryPrompt } from '@/lib/learner-memory/prompt';

describe('Memory transition', () => {
  it('merges explicitly retired content while retaining both source versions and conditions', () => {
    const r = runFixture();
    const old = validateTransition(r, response()).snapshot;
    const { version: _version, ...raw } = r.batch[0];
    const increment = versionSource({
      ...raw,
      id: 'another',
      text: '另一次合成练习提供了不同表现。',
      refs: ['quiz:N04:S2:q3'],
      conditions: ['另一任务的提示条件'],
    });
    const next = {
      ...r,
      snapshot: old,
      baseRevision: old.revision,
      batch: [increment],
      ...buildMemoryPrompt(old, [increment], r.budgets, r.batch),
    };
    const output = response();
    output.pieces[0].supports = ['e1', 's1'];
    const result = validateTransition(next, {
      ...output,
      retired: [
        {
          id: old.pieces[0].id,
          section: 'learning_experiences',
          action: 'merge',
          replacements: ['new:1'],
          reason: '合成连续场景的明确合并fixture',
        },
      ],
    });
    expect(result.snapshot.pieces).toHaveLength(1);
    expect(result.snapshot.pieces[0].supports).toHaveLength(2);
    expect(result.snapshot.pieces[0].conditions).toContain('另一任务的提示条件');
  });
  it('can mark a new record already represented without changing or double-adopting old content', () => {
    const r = runFixture();
    const old = validateTransition(r, response()).snapshot;
    const result = validateTransition(
      { ...r, snapshot: old },
      {
        status: 'ready',
        sections: [],
        pieces: [],
        retired: [],
        decisions: [
          {
            source: 'e1',
            action: 'already_represented',
            pieceIds: [old.pieces[0].id],
            reason: '已有信息足够',
          },
        ],
      },
    );
    expect(result.snapshot.pieces).toEqual(old.pieces);
    expect(result.decisions[0].action).toBe('already_represented');
  });
  it('binds exact support snapshots and preserves source conditions deterministically', () => {
    const r = runFixture(),
      out = validateTransition(r, response());
    expect(out.snapshot.revision).toBe(1);
    expect(out.snapshot.pieces[0].conditions).toEqual(r.batch[0].conditions);
    expect(out.snapshot.sections.goals).toEqual([]);
    expect(out.snapshot.pieces[0].supports[0]).toEqual(r.batch[0]);
  });
  it('owns conditions in the program and refuses to reinterpret frozen v1 replies', () => {
    const r = runFixture();
    const oldOutput = response();
    expect(() =>
      validateTransition(r, {
        ...oldOutput,
        pieces: oldOutput.pieces.map((p) => ({ ...p, conditions: ['模型改写条件'] })),
      }),
    ).toThrow();
    expect(() =>
      validateTransition({ ...r, prompt: { ...r.prompt, version: 'memory.v1' } }, response()),
    ).toThrow('PROMPT_VERSION_UNSUPPORTED');
  });
  it('accepts exactly the Unicode body budget and rejects an extra code point without truncating', () => {
    const r = runFixture(),
      out = response();
    out.pieces[0].text = '提示下答对😀';
    const limit = [...out.pieces[0].text].length;
    const limited = {
      ...r,
      budgets: {
        ...r.budgets,
        total: limit,
        sections: { ...r.budgets.sections, learning_experiences: limit },
      },
    };
    expect(validateTransition(limited, out).snapshot.pieces[0].text).toBe(out.pieces[0].text);
    out.pieces[0].text += '。';
    expect(() => validateTransition(limited, out)).toThrow('SECTION_BUDGET_EXCEEDED');
    expect(r.snapshot.pieces).toEqual([]);
  });
  it('rejects orphan, foreign refs, capacity and omitted batch decisions', () => {
    const r = runFixture();
    const foreign = response();
    foreign.pieces[0].supports = ['foreign'];
    expect(() => validateTransition(r, foreign)).toThrow('UNKNOWN_SOURCE');
    const orphan = response();
    orphan.sections[0].pieceIds = [];
    expect(() => validateTransition(r, orphan)).toThrow('ORPHAN_PIECE');
    const missing = response();
    missing.decisions = [];
    expect(() => validateTransition(r, missing)).toThrow('BATCH_COVERAGE');
    expect(() =>
      validateTransition({ ...r, budgets: { ...r.budgets, total: 1 } }, response()),
    ).toThrow('TOTAL_BUDGET_EXCEEDED');
  });
  it('requires old-piece disposition and protects shared view identities', () => {
    const r = runFixture(),
      first = validateTransition(r, response()).snapshot;
    const id = first.pieces[0].id;
    const next = { ...r, snapshot: first };
    expect(() => validateTransition(next, response())).toThrow('OLD_PIECE_DISPOSITION');
    first.sections.goals = [id];
    const changed = response();
    changed.pieces[0].id = id;
    changed.sections[0].pieceIds = [id];
    changed.decisions[0].pieceIds = [id];
    expect(() => validateTransition(next, changed)).toThrow('SHARED_PIECE_SECTION_OMITTED');
  });
  it('supports non-adoption and deferral without manufacturing memory', () => {
    for (const action of ['not_adopt', 'defer']) {
      const out = validateTransition(runFixture(), {
        status: 'ready',
        sections: [],
        pieces: [],
        retired: [],
        decisions: [{ source: 'e1', action, pieceIds: [], reason: '暂不采用' }],
      });
      expect(out.snapshot.pieces).toEqual([]);
      expect(out.decisions[0].action).toBe(action);
    }
  });
  it('does not quietly adopt rejected or deferred increments', () => {
    const out = response();
    out.decisions[0].action = 'defer';
    out.decisions[0].pieceIds = [];
    expect(() => validateTransition(runFixture(), out)).toThrow('UNDECLARED_ADOPTION');
  });
  it('restricts only the affected piece in both projections', () => {
    const s = validateTransition(runFixture(), response()).snapshot;
    s.pieces[0].restrictions.push('source withdrawn');
    expect(projectMemory(s).pieces).toEqual([]);
    expect(projectMemory(s).restricted).toHaveLength(1);
    expect(renderMemory(s)).not.toContain(s.pieces[0].text);
    expect(renderMemory(s)).toContain('排除');
  });
});
