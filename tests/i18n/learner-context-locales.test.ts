import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import en from '@/lib/i18n/locales/en-US.json';
import zh from '@/lib/i18n/locales/zh-CN.json';
import { supportedLocales } from '@/lib/i18n/locales';

const keys = [
  'simulatedLearnerLabel',
  'simulatedLearnerNone',
  'simulatedLearnerOption',
  'simulatedLearnerHint',
  'simulatedLearnerUnsupported',
  'preparingLearnerContext',
  'preparingLearnerContextDesc',
  'learnerContextSummary',
  'learnerContextEmpty',
  'learnerContextNoRelevant',
  'learnerContextViewSelection',
  'learnerContextConditions',
  'learnerMemoryUnavailable',
  'learnerMemoryRecheckRequired',
  'learnerMemorySourceInvalid',
  'learnerContextInvalid',
  'learnerContextCallUnknown',
] as const;

describe('simulated Memory messages', () => {
  it.each(supportedLocales)(
    'provides every message in $code, using explicit English fallback outside zh-CN',
    ({ code }) => {
      const locale = JSON.parse(
        readFileSync(join(process.cwd(), 'lib/i18n/locales', `${code}.json`), 'utf8'),
      );
      for (const key of keys) {
        expect(locale.generation[key], `${code}: ${key}`).toBeTruthy();
        if (code !== 'zh-CN') expect(locale.generation[key]).toBe(en.generation[key]);
      }
      expect(locale.generation.simulatedLearnerOption).toContain('{{learner}}');
      expect(locale.generation.learnerContextSummary).toContain('{{learner}}');
      expect(locale.generation.learnerContextSummary).toContain('{{count}}');
    },
  );

  it('explains unknown calls, artificial sources, and empty Memory in both authored languages', () => {
    expect(en.generation.learnerContextCallUnknown).toContain('new model call');
    expect(zh.generation.learnerContextCallUnknown).toContain('新的模型调用');
    expect(en.generation.simulatedLearnerHint).toContain('artificial');
    expect(zh.generation.simulatedLearnerHint).toContain('人工模拟');
    expect(en.generation.learnerContextEmpty).toContain('does not indicate');
    expect(zh.generation.learnerContextEmpty).toContain('不表示能力较低');
  });
});
