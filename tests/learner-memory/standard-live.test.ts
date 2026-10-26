import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { verifyTrialInput } from '@/eval/learner-memory/standard-live';
import { loadStandardCorpus } from '@/eval/learner-memory/standard-replay';

describe('live standard input boundary', () => {
  it('uses the frozen input, and rejects changed old memory or substituted incremental evidence', () => {
    const corpus = loadStandardCorpus(path.resolve('..'));
    const test = corpus.cases.find((c) => c.id === 'U02')!;
    const packet = JSON.parse(
      fs.readFileSync(
        path.resolve('../docs/log/artifacts/F67/memory-v0.2-2026-10-25/prepared-five-002/U02.json'),
        'utf8',
      ),
    );
    const fixed = { id: test.id, scope: test.scope, input: test.input };
    expect(() => verifyTrialInput(packet, fixed)).not.toThrow();
    const changed = structuredClone(packet);
    changed.input.input.beforeMemory.pieces[0].text = '被替换的旧记忆';
    expect(() => verifyTrialInput(changed, fixed)).toThrow('FIXED_STANDARD_INPUT_CHANGED');
    const substituted = structuredClone(packet);
    substituted.input.input.incomingSourceIds = ['f64:N04:1'];
    expect(() => verifyTrialInput(substituted, fixed)).toThrow('FIXED_STANDARD_INPUT_CHANGED');
  });
});
