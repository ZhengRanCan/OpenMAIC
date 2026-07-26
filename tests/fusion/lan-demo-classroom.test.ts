import { describe, expect, it } from 'vitest';
import { LAN_DEMO_CLASSROOM } from '@/lib/fusion/lan-demo-classroom';

describe('F21 LAN demo classroom', () => {
  it('is a fixed, synthetic Student A linear-function lesson with no provider material', () => {
    expect(LAN_DEMO_CLASSROOM).toMatchObject({
      schemaVersion: 'v1',
      demoStudent: 'a',
      topic: '一次函数',
      synthetic: true,
    });
    expect(LAN_DEMO_CLASSROOM.scenes).toHaveLength(4);
    expect(JSON.stringify(LAN_DEMO_CLASSROOM)).not.toMatch(
      /api.?key|token|cookie|provider|promptText|learnerId/i,
    );
  });
});
