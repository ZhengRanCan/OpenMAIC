import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseHTML } from 'linkedom';
import { describe, expect, it, vi } from 'vitest';

import en from '@/lib/i18n/locales/en-US.json';
import { SimulatedLearnerSelect } from '@/components/generation/simulated-learner-select';

vi.mock('@/lib/hooks/use-i18n', () => ({
  useI18n: () => ({
    t: (key: string, values: Record<string, string> = {}) => {
      const text = key.split('.').reduce<unknown>((value, part) => {
        return (value as Record<string, unknown>)[part];
      }, en) as string;
      return text.replace(/\{\{(\w+)\}\}/g, (_, name: string) => values[name] ?? '');
    },
  }),
}));

function render(extra: Partial<Parameters<typeof SimulatedLearnerSelect>[0]> = {}) {
  return parseHTML(
    renderToStaticMarkup(
      createElement(SimulatedLearnerSelect, {
        value: '',
        onChange: () => undefined,
        unsupported: false,
        ...extra,
      }),
    ),
  ).document;
}

describe('the simulated student selector', () => {
  it('has a keyboard-native input with a linked label and explanatory text', () => {
    const document = render();
    const select = document.querySelector('select')!;
    expect(document.querySelector('label')?.getAttribute('for')).toBe(select.id);
    expect(document.getElementById(select.getAttribute('aria-describedby')!)?.textContent).toBe(
      en.generation.simulatedLearnerHint,
    );
    expect(select.hasAttribute('disabled')).toBe(false);
    expect(Array.from(document.querySelectorAll('option')).map((option) => option.value)).toEqual([
      '',
      'A',
      'B',
      'C',
    ]);
  });

  it('preserves the explicit selection while a run is starting', () => {
    const document = render({ value: 'B', disabled: true });
    expect(document.querySelector('select')?.hasAttribute('disabled')).toBe(true);
    expect(document.querySelector('option[selected]')?.getAttribute('value')).toBe('B');
  });

  it('disables selection and announces the ordinary-course restriction in unsupported modes', () => {
    const document = render({ unsupported: true });
    expect(document.querySelector('select')?.hasAttribute('disabled')).toBe(true);
    expect(document.querySelector('[role="status"]')?.textContent).toBe(
      en.generation.simulatedLearnerUnsupported,
    );
  });
});
