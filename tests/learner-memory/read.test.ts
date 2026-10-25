import { describe, expect, it } from 'vitest';
import { projectMemory, renderMemory } from '@/lib/learner-memory/read';
import { validateTransition } from '@/lib/learner-memory/transition';
import { response, runFixture } from './fixtures';

describe('Memory usable projection', () => {
  it('keeps unaffected information while locally excluding invalid support', () => {
    const snapshot = validateTransition(runFixture(), response()).snapshot;
    const first = snapshot.pieces[0];
    snapshot.pieces.push({
      ...structuredClone(first),
      id: 'valid',
      text: '仍有效的另一经历',
      restrictions: [],
    });
    snapshot.sections.learning_experiences.push('valid');
    first.restrictions.push('依据撤回');
    expect(projectMemory(snapshot).pieces.map((p) => p.id)).toEqual(['valid']);
    expect(renderMemory(snapshot)).toContain('仍有效的另一经历');
    expect(renderMemory(snapshot)).not.toContain(first.text);
    expect(first.supports.length).toBeGreaterThan(0);
  });
});
