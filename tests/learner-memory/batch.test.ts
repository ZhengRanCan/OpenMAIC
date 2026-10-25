import path from 'node:path';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyPreparedPacket } from '@/eval/learner-memory/runner';
import { loadMemoryCases } from '@/eval/learner-memory/inputs';
import { DEFAULT_BUDGETS, emptySnapshot, versionSource } from '@/lib/learner-memory/contracts';
import { buildMemoryPrompt } from '@/lib/learner-memory/prompt';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
function fixture() {
  const sources = loadMemoryCases(path.resolve('..'), 'manual').find(
    (c) => c.caseId === 'N04',
  )!.sources;
  const packet = {
    caseId: 'N04',
    scope: { namespace: 'f67-test:batch-check', learnerKey: 'N04' },
    operationId: 'initial',
    sources,
    prompt: buildMemoryPrompt(emptySnapshot(), sources, DEFAULT_BUDGETS, []).prompt,
  };
  const text = JSON.stringify(packet);
  return {
    packet,
    text,
    manifest: {
      namespace: packet.scope.namespace,
      mode: 'manual' as const,
      budgets: DEFAULT_BUDGETS,
      packetFiles: { N04: sha(text) },
    },
  };
}
describe('Prepared request freeze', () => {
  it('accepts an exact packet, rejects edited bytes before persistence', () => {
    const f = fixture();
    expect(verifyPreparedPacket(f.manifest, 'N04', f.text)).toBeTruthy();
    expect(() => verifyPreparedPacket(f.manifest, 'N04', f.text + ' ')).toThrow(
      'PACKET_FILE_CHANGED',
    );
  });
  it('rejects changed input even if its version, prompt and local byte hash were recalculated', () => {
    const f = fixture();
    const { version: _version, ...raw } = f.packet.sources[0];
    f.packet.sources[0] = versionSource({ ...raw, text: '被替换为不属于固定输入的内容' });
    f.packet.prompt = buildMemoryPrompt(
      emptySnapshot(),
      f.packet.sources,
      DEFAULT_BUDGETS,
      [],
    ).prompt;
    const text = JSON.stringify(f.packet);
    f.manifest.packetFiles.N04 = sha(text);
    expect(() => verifyPreparedPacket(f.manifest, 'N04', text)).toThrow('FIXED_INPUT_MISMATCH');
  });
  it('rejects changed prompt even if the local packet hash was updated', () => {
    const f = fixture();
    f.packet.prompt.user += '额外指令';
    const text = JSON.stringify(f.packet);
    f.manifest.packetFiles.N04 = sha(text);
    expect(() => verifyPreparedPacket(f.manifest, 'N04', text)).toThrow('FIXED_PROMPT_MISMATCH');
  });
});
