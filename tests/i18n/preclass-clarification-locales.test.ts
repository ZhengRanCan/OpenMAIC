import { describe, expect, it } from 'vitest';
import zhCN from '@/lib/i18n/locales/zh-CN.json';
import zhTW from '@/lib/i18n/locales/zh-TW.json';

const clarificationKeys = [
  'clarificationRequired',
  'clarificationDesc',
  'clarificationPlaceholder',
  'clarificationSubmit',
  'clarificationSubmitting',
  'clarificationFailed',
] as const;

describe('pre-class clarification Chinese locales', () => {
  it('contains readable Chinese copy instead of encoding placeholders', () => {
    for (const [locale, generation] of Object.entries({
      'zh-CN': zhCN.generation,
      'zh-TW': zhTW.generation,
    })) {
      for (const key of clarificationKeys) {
        const value = generation[key];
        expect(value, `${locale}.${key} should be non-empty`).toBeTypeOf('string');
        expect(value.trim(), `${locale}.${key} should not be empty`).not.toBe('');
        expect(value, `${locale}.${key} contains replacement question marks`).not.toMatch(/^\?+$/);
        expect(value, `${locale}.${key} contains the literal replacement marker`).not.toContain(
          '�',
        );
      }
    }
  });

  it('keeps the required clarification intent in both Chinese variants', () => {
    expect(zhCN.generation.clarificationDesc).toContain('发起人');
    expect(zhCN.generation.clarificationDesc).toContain('重新冻结');
    expect(zhTW.generation.clarificationDesc).toContain('發起人');
    expect(zhTW.generation.clarificationDesc).toContain('重新凍結');
    expect(zhCN.generation.clarificationFailed).toContain('失败');
    expect(zhTW.generation.clarificationFailed).toContain('失敗');
  });

  it('provides explicit ordinary-classroom recovery copy', () => {
    expect(zhCN.generation.nonFusionRecoveryDesc).toContain('普通课堂');
    expect(zhCN.generation.nonFusionRecoveryAction).toContain('普通课堂');
    expect(zhTW.generation.nonFusionRecoveryDesc).toContain('普通課堂');
    expect(zhTW.generation.nonFusionRecoveryAction).toContain('普通課堂');
  });
});
