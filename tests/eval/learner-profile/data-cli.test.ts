import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderQuestion, goldKey, importLongTutor } from '@/eval/learner-profile/longtutor';
import { createOutput, output, readRecords, sourceFiles } from '@/eval/learner-profile/io';

const info = {
  type: '填空题',
  content: '合成题',
  options: { B: '二', A: '一' },
  concepts: ['root----算术----加法', 'root----算术'],
};
function corpus() {
  const dir = mkdtempSync(join(tmpdir(), 'f113-test-'));
  const last = { question: 'q2', response: 0 as const, timestamp: '2020-01-01T10:00:00' };
  const sequence = {
    uid: 'fake-student',
    sequence: [{ question: 'q1', response: 1, timestamp: '2020-01-01T09:00:00' }, last],
  };
  const gold = {
    _key: goldKey(sequence.uid, renderQuestion(info, last)),
    memory: [
      { query: '历史事实?', answer: '正确' },
      { query: '跨次表现?', answer: '有变化' },
      { query: '无记录?', answer: '未知，不可猜测' },
    ],
  };
  const seq = join(dir, 'seq.jsonl'),
    bank = join(dir, 'bank.jsonl'),
    labels = join(dir, 'gold.jsonl');
  writeFileSync(seq, JSON.stringify(sequence) + '\n');
  writeFileSync(
    bank,
    ['q1', 'q2']
      .map((id) =>
        JSON.stringify({
          id,
          info: { ...info, answer: ['hidden'], analysis: 'HIDDEN_ANSWER_EXPLANATION' },
        }),
      )
      .join('\n'),
  );
  writeFileSync(labels, JSON.stringify(gold) + '\n');
  return { dir, seq, bank, labels, gold, sequence };
}
describe('F113 data adapters and output boundaries', () => {
  it('renders the exact XES concept segments and preserves option insertion order', () => {
    expect(
      renderQuestion(info, { question: 'q2', response: 0, timestamp: '2020-01-01T10:00:00' }),
    ).toBe(
      '[q2]\n填空题: 合成题\nB: 二; A: 一\n知识点: 算术, 加法\n时间: 2020-01-01T10:00:00\n结果: 错误',
    );
    expect(
      renderQuestion({ ...info, concepts: [], options: {} }, { question: 'q', response: 1 }),
    ).toContain('知识点: []\n结果: 正确');
  });
  it('joins gold without optional memory IDs and excludes the current event and answer keys', async () => {
    const c = corpus();
    const result = await importLongTutor(c.seq, c.bank, c.labels, 1);
    expect(result.manifest.matched).toBe(1);
    expect(result.events).toHaveLength(1);
    expect(result.questions).toHaveLength(3);
    expect(result.events[0].questionId).toBe('q1');
    expect(result.events[0].occurredAt).toBeNull();
    expect(result.events[0].recordedTime).toBe('2020-01-01T09:00:00');
    expect(result.questions[2].gold).toBe('未知，不可猜测');
    expect(JSON.stringify(result.events)).not.toMatch(/HIDDEN_ANSWER_EXPLANATION|hidden|历史事实/);
    expect(result.events[0].parts[0].answer).toBeUndefined();
  });
  it('fails loudly on unmatched or duplicated Gold keys', async () => {
    const c = corpus();
    writeFileSync(c.labels, JSON.stringify({ ...c.gold, _key: 'wrong' }) + '\n');
    await expect(importLongTutor(c.seq, c.bank, c.labels, 1)).rejects.toThrow(
      'NO_GOLD_ASSOCIATIONS',
    );
    writeFileSync(c.labels, [c.gold, c.gold].map((x) => JSON.stringify(x)).join('\n'));
    await expect(importLongTutor(c.seq, c.bank, c.labels, 1)).rejects.toThrow('GOLD_KEY_DUPLICATE');
  });
  it('does not silently accept swapped Q1/Q2/Q3 labels', async () => {
    const c = corpus();
    c.gold.memory[0] = { ...c.gold.memory[0], ...{ id: 'Q2' } };
    writeFileSync(c.labels, JSON.stringify(c.gold));
    await expect(importLongTutor(c.seq, c.bank, c.labels, 1)).rejects.toThrow(
      'GOLD_QUERY_ORDER_INVALID',
    );
  });
  it('never overwrites input directories, existing runs or artifacts', () => {
    const c = corpus(),
      target = join(c.dir, 'run');
    createOutput(target, [c.seq]);
    output(join(target, 'state.json'), { revision: 1 });
    expect(() => createOutput(target, [c.seq])).toThrow('OUTPUT_EXISTS_OR_OVERLAPS_INPUT');
    expect(() => createOutput(c.dir, [c.seq])).toThrow();
    expect(() => output(join(target, 'state.json'), {})).toThrow();
    expect(JSON.parse(readFileSync(join(target, 'state.json'), 'utf8')).revision).toBe(1);
  });
  it('supports newline records and hashes the exact executable source files', () => {
    const c = corpus();
    expect(readRecords(c.seq)).toHaveLength(1);
    expect(sourceFiles()['eval/learner-profile/engine.ts']).toMatch(/^[a-f0-9]{64}$/);
    const occupied = join(c.dir, 'occupied');
    mkdirSync(occupied);
    expect(() => createOutput(occupied, [])).toThrow();
  });
});
