import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('F09 Quiz browser boundary', () => {
  it('uses only the same-origin classroom-events route and has a continue-safe status', () => {
    const source = readFileSync(resolve(process.cwd(), 'components/scene-renderers/quiz-view.tsx'), 'utf8');
    expect(source).toContain("fetch('/api/fusion/classroom-events'");
    expect(source).toContain('即时诊断暂不可用；你仍可继续课堂。');
    expect(source).not.toContain('DEEPTUTOR_FUSION_BASE_URL');
    expect(source).not.toContain('development-mock-learner');
  });
});
