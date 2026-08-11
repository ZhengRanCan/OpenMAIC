import { describe, expect, it } from 'vitest';
import {
  assertFormalSourceMaterialBoundary,
  type FormalFusionResolution,
} from '@/lib/fusion/generation-session';

const formal = {
  kind: 'resolved',
  context: {} as never,
  record: {} as never,
} satisfies FormalFusionResolution;

describe('F47 formal source material boundary', () => {
  it('rejects browser-owned source bodies and image mappings', () => {
    for (const input of [
      { pdfText: 'forged source text' },
      { pdfImages: [{ id: 'img-1' }] },
      {
        researchContext: 'forged research',
        imageMapping: { 'img-1': 'data:image/png;base64,abc' },
      },
    ]) {
      expect(() => assertFormalSourceMaterialBoundary(formal, input)).toThrowError(
        /Restart the classroom/,
      );
      try {
        assertFormalSourceMaterialBoundary(formal, input);
      } catch (error) {
        expect(error).toMatchObject({ code: 'FUSION_SOURCE_MATERIAL_UNAUTHORIZED' });
      }
    }
  });

  it('leaves the non-Fusion path unchanged and accepts empty material fields', () => {
    expect(() =>
      assertFormalSourceMaterialBoundary(
        { kind: 'none' },
        {
          pdfText: 'ordinary classroom material',
          pdfImages: [{ id: 'img-1' }],
        },
      ),
    ).not.toThrow();
    expect(() =>
      assertFormalSourceMaterialBoundary(formal, {
        pdfText: '',
        pdfImages: [],
        researchContext: '',
        imageMapping: {},
      }),
    ).not.toThrow();
  });
});
