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
});
