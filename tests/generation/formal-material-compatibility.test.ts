import { describe, expect, it } from 'vitest';
import {
  shouldPromptFormalMaterialCompatibility,
  type FormalMaterialCompatibilityInput,
} from '@/app/generation-preview/formal-material-compatibility';

describe('F53 formal material compatibility prompt', () => {
  const cases: Array<[string, FormalMaterialCompatibilityInput, boolean]> = [
    [
      'formal fusion with materials',
      { formalLessonSessionId: 'fusion-1', courseMaterialsCount: 1 },
      true,
    ],
    [
      'formal fusion without materials',
      { formalLessonSessionId: 'fusion-1', courseMaterialsCount: 0 },
      false,
    ],
    [
      'ordinary classroom with materials',
      { formalLessonSessionId: null, courseMaterialsCount: 2 },
      false,
    ],
    [
      'forced ordinary recovery',
      { formalLessonSessionId: 'fusion-1', courseMaterialsCount: 3, forceOrdinary: true },
      false,
    ],
  ];

  it.each(cases)('%s', (_label, input, expected) => {
    expect(shouldPromptFormalMaterialCompatibility(input)).toBe(expected);
  });

  it('stays fail-closed for any positive material count in formal Fusion', () => {
    for (const count of [1, 2, 5]) {
      expect(
        shouldPromptFormalMaterialCompatibility({
          formalLessonSessionId: 'fusion-1',
          courseMaterialsCount: count,
        }),
      ).toBe(true);
    }
  });
});
