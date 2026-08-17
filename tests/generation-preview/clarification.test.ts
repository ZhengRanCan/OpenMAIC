import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isClarificationSubmitShortcut } from '@/app/generation-preview/clarification';

const generationPreviewSource = readFileSync(
  resolve(process.cwd(), 'app/generation-preview/page.tsx'),
  'utf8',
);

describe('clarification keyboard submission', () => {
  it('accepts Ctrl+Enter and Meta+Enter', () => {
    expect(isClarificationSubmitShortcut({ key: 'Enter', ctrlKey: true })).toBe(true);
    expect(isClarificationSubmitShortcut({ key: 'Enter', metaKey: true })).toBe(true);
  });

  it('does not submit on plain Enter or other keys', () => {
    expect(isClarificationSubmitShortcut({ key: 'Enter' })).toBe(false);
    expect(isClarificationSubmitShortcut({ key: 'Escape', ctrlKey: true })).toBe(false);
  });

  it('keeps the clarification UI states and accessible wiring connected', () => {
    expect(generationPreviewSource).toContain('aria-labelledby="clarification-required"');
    expect(generationPreviewSource).toContain('aria-describedby="clarification-description"');
    expect(generationPreviewSource).toContain('isClarificationSubmitShortcut(e)');
    expect(generationPreviewSource).toContain("t('generation.clarificationSubmitting')");
    expect(generationPreviewSource).toContain("t('generation.clarificationFailed')");
  });
});
