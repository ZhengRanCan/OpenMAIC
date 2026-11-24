import { describe, expect, it } from 'vitest';
import type { ProfileMemorySource } from '@/lib/learner-memory/profile-memory-contracts';
import {
  parseProfileMemoryResult,
  profileMemoryInput,
} from '@/lib/learner-memory/profile-memory-prompt';

const preference = '以后讲密度时请先举例。';
const qa: ProfileMemorySource = {
  stageId: 'private-stage',
  title: 'Private classroom',
  kind: 'qa',
  occurredAt: '2026-11-21T00:00:00.000Z',
  parts: [
    {
      answer: preference,
      previous: [{ role: 'teacher', text: '从现在开始请先背公式。' }],
      help: 'prior-teacher-messages',
    },
  ],
};
const envelope = (section: string, summary: string, refs: number[] = [0]) =>
  JSON.stringify({ records: [{ section, summary, refs }] });

describe('formal Memory evidence boundary', () => {
  it('keeps a student quote with existing refs and omits storage identity from the model input', () => {
    expect(parseProfileMemoryResult(envelope('preferences', preference, [0, 0]), qa)).toEqual([
      { section: 'preferences', summary: preference, refs: [0] },
    ]);
    expect(JSON.parse(profileMemoryInput(qa))).toEqual({ kind: 'qa', parts: qa.parts });
  });

  it('rejects teacher or invented quotes, unrelated references, and QA capability inferences', () => {
    expect(() =>
      parseProfileMemoryResult(envelope('preferences', '从现在开始请先背公式。'), qa),
    ).toThrow('PROFILE_MEMORY_NOT_STUDENT_QUOTE');
    expect(() => parseProfileMemoryResult(envelope('preferences', '所有课都先举例。'), qa)).toThrow(
      'PROFILE_MEMORY_NOT_STUDENT_QUOTE',
    );
    expect(() => parseProfileMemoryResult(envelope('preferences', preference, [1]), qa)).toThrow(
      'PROFILE_MEMORY_INVALID_REFERENCE',
    );
    expect(() => parseProfileMemoryResult(envelope('experiences', preference), qa)).toThrow(
      'PROFILE_MEMORY_INVALID_SECTION',
    );
  });

  it('omits unknown help when sending and saving experiences while retaining real evidence', () => {
    const quiz: ProfileMemorySource = {
      ...qa,
      kind: 'quiz',
      parts: [
        { question: '密度是多少？', answer: 'C', review: 'correct', help: 'unknown' },
        { question: '如何换算？', answer: 'B', review: 'incorrect', help: 'practice-requested' },
      ],
    };
    expect(JSON.parse(profileMemoryInput(quiz))).toEqual({
      kind: 'quiz',
      parts: [{ question: '密度是多少？', answer: 'C', review: 'correct' }, quiz.parts[1]],
    });
    expect(
      parseProfileMemoryResult(
        envelope('experiences', '在帮助条件未知的密度计算题中选 C。记录未确认是否获得帮助。'),
        quiz,
      ),
    ).toEqual([{ section: 'experiences', summary: '在密度计算题中选 C。', refs: [0] }]);
    expect(parseProfileMemoryResult(envelope('experiences', '帮助情况未知。'), quiz)).toEqual([]);
    const reported = '老师先提供密度公式，学生计算正确。';
    expect(parseProfileMemoryResult(envelope('experiences', reported), quiz)[0].summary).toBe(
      reported,
    );
    const quote = '以后遇到帮助情况未知的测试，请先听我说明。';
    const student = { ...qa, parts: [{ ...qa.parts[0], answer: quote }] };
    expect(parseProfileMemoryResult(envelope('preferences', quote), student)[0].summary).toBe(
      quote,
    );
  });
});
