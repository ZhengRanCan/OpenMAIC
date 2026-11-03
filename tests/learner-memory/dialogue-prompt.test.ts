import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import {
  DIALOGUE_MEMORY_SYSTEM,
  DIALOGUE_MEMORY_PROMPT_VERSION,
} from '@/lib/learner-memory/dialogue-prompt';
import {
  SIMULATED_MEMORY_SYSTEM,
  SIMULATED_PROMPT_SHA256,
} from '@/lib/learner-memory/simulated-prompt';
describe('Dialogue-compatible Memory prompt', () => {
  it('versions the chronology rules without changing the frozen Quiz System or output protocol', () => {
    expect(DIALOGUE_MEMORY_PROMPT_VERSION).toBe('dialogue-memory.v2.1');
    expect(DIALOGUE_MEMORY_SYSTEM).toContain(DIALOGUE_MEMORY_PROMPT_VERSION);
    for (const rule of [
      '教师给定的数值、换算结果或计算步骤，不等于学生实际产出',
      '随后',
      '没有后续学生回复',
      '不能倒置时序',
      '600÷30',
      '不是学生完成了kg到g的换算',
      '分开保留或省略',
    ])
      expect(DIALOGUE_MEMORY_SYSTEM).toContain(rule);
    expect(DIALOGUE_MEMORY_SYSTEM).toContain('memory.v2');
  });
  it('requires decisions for batch e aliases only, including an empty list for maintenance-only updates', () => {
    for (const rule of [
      'decisions只覆盖本次batch的e别名',
      's别名只可用于supports',
      'batch为空时必须输出decisions: []',
      '仍可返回ready',
      '改写或退役旧片段',
    ])
      expect(DIALOGUE_MEMORY_SYSTEM).toContain(rule);
  });
  it('keeps the frozen previous System and extends memory.v2 without forcing adoption', () => {
    expect(createHash('sha256').update(SIMULATED_MEMORY_SYSTEM).digest('hex')).toBe(
      SIMULATED_PROMPT_SHA256,
    );
    expect(DIALOGUE_MEMORY_SYSTEM).toContain(SIMULATED_MEMORY_SYSTEM);
    for (const text of [
      'dialogue_evidence',
      'question_help',
      'learning_performance',
      'synthesis',
      '共同',
      '帮助',
      'defer',
    ])
      expect(DIALOGUE_MEMORY_SYSTEM).toContain(text);
  });
});
