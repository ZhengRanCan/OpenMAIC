import { describe, expect, it } from 'vitest';
import { isClarificationSubmitShortcut } from '@/app/generation-preview/clarification';

describe('clarification keyboard submission', () => {
  it('accepts Ctrl+Enter and Meta+Enter', () => {
    expect(isClarificationSubmitShortcut({ key: 'Enter', ctrlKey: true })).toBe(true);
    expect(isClarificationSubmitShortcut({ key: 'Enter', metaKey: true })).toBe(true);
  });

  it('does not submit on plain Enter or other keys', () => {
    expect(isClarificationSubmitShortcut({ key: 'Enter' })).toBe(false);
    expect(isClarificationSubmitShortcut({ key: 'Escape', ctrlKey: true })).toBe(false);
  });
});
