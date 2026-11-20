import { describe, expect, it, vi } from 'vitest';

import { selectPlannerMastery } from '@/lib/learner-mastery/planning';
import type { PlannerMastery } from '@/lib/server/learner-mastery';

const candidates: PlannerMastery[] = [
  {
    target: { id: 'historical-run:target:2', revision: 1, statement: 'Convert density units.' },
    summary: 'The earlier conversion was incorrect.',
    unverified: ['Try an unassisted conversion.'],
    observations: [
      {
        assistance: 'assisted',
        coverage: 'direct',
        result: 'incorrect',
        text: 'Selected the wrong conversion.',
        conditions: ['Formula was supplied.'],
      },
    ],
  },
];
const input = {
  requirement: 'Review density conversions.',
  objectives: {
    courseObjective: 'Convert density units.',
    targetStatements: ['Convert g/cm³ to kg/m³.'],
  },
};

describe('Mastery selection for the outline', () => {
  it('sends only the task and target statements to choose which private history to adopt', async () => {
    const select = vi.fn<Parameters<typeof selectPlannerMastery>[2]>(
      async () => '{"selected":["M1"]}',
    );
    expect(await selectPlannerMastery(candidates, input, select)).toEqual(candidates);
    const [{ user }] = select.mock.calls[0]!;
    expect(JSON.parse(user)).toEqual({
      ...input,
      candidates: [{ id: 'M1', statement: 'Convert density units.' }],
    });
  });

  it('omits history when no candidate is relevant', async () => {
    expect(await selectPlannerMastery(candidates, input, async () => '{"selected":[]}')).toEqual(
      [],
    );
    const select = vi.fn();
    expect(await selectPlannerMastery([], input, select)).toEqual([]);
    expect(select).not.toHaveBeenCalled();
  });

  it.each([
    '{"selected":["unknown"]}',
    '{"selected":["M1","M1"]}',
    '{"selected":["M1"],"summary":"injected"}',
    '{"selected":[1]}',
    'not-json',
  ])('refuses invalid selections %s', async (reply) => {
    await expect(selectPlannerMastery(candidates, input, async () => reply)).rejects.toThrow();
  });
});
