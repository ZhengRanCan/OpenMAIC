import { it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
it('provides complete two-stage and paid-recovery messages in every supported locale', () => {
  const dir = path.resolve('lib/i18n/locales');
  const en = JSON.parse(readFileSync(path.join(dir, 'en-US.json'), 'utf8')).chat.learning;
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    const messages = JSON.parse(readFileSync(path.join(dir, file), 'utf8')).chat.learning;
    expect(Object.keys(messages).sort(), file).toEqual(Object.keys(en).sort());
    expect(Object.values(messages).every((x) => typeof x === 'string' && x.trim().length > 0)).toBe(
      true,
    );
  }
});
