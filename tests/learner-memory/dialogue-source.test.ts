import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { adaptDialogueMemorySources } from '@/lib/learner-memory/dialogue-source';
import { assertSource } from '@/lib/learner-memory/contracts';
import type { DialogueEvidenceRun } from '@/lib/dialogue/evidence-contracts';

function run(caseId = 'D01'): DialogueEvidenceRun {
  return JSON.parse(
    readFileSync(`../docs/log/artifacts/F73/live-001/${caseId}.result.json`, 'utf8'),
  );
}
describe('Dialogue facts to shared Memory sources', () => {
  it('keeps two categories, exact helped text, time and immutable provenance', () => {
    const r = run(),
      sources = adaptDialogueMemorySources(r);
    expect(sources).toHaveLength(2);
    for (const { source } of sources) {
      expect(assertSource(source)).toEqual(source);
      expect(source.kind).toBe('dialogue_evidence');
      expect(source.id).toMatch(/^sim:A:dialogue:[a-f0-9]{64}$/);
      expect(source.occurredAt).toBeTruthy();
      expect(source.conditions.join(' ')).toContain('window-only');
      expect(source.provenance.file).toContain(r.id);
    }
    expect(sources[1].source.text).toContain('在教师给出');
    expect(sources[0].source.refs[1]).toContain('d01-m02');
    expect(sources[1].source.refs[0]).toContain('d01-m02');
  });
  it('gives unchanged actual facts the same identity in another Evidence version', () => {
    const r = run(),
      first = adaptDialogueMemorySources(r);
    r.id = 'new-evidence';
    r.createdAt = new Date().toISOString();
    r.facts.forEach((f, i) => {
      f.id = 'new-evidence:' + i;
      f.snapshotId = r.id;
    });
    expect(adaptDialogueMemorySources(r).map((x) => x.key)).toEqual(first.map((x) => x.key));
  });
  it('allows empty and leaves absent student times unknown', () => {
    expect(adaptDialogueMemorySources(run('D06'))).toEqual([]);
    const r = run();
    for (const m of r.snapshot!.messages)
      if (m.message.metadata) delete m.message.metadata.createdAt;
    expect(adaptDialogueMemorySources(r).every((x) => x.source.occurredAt === null)).toBe(true);
  });
  it('rejects non-final, forged facts, mismatched owner and oversized batches rather than partial delivery', () => {
    for (const mutate of [
      (r: DialogueEvidenceRun) => {
        r.state = 'unknown';
      },
      (r: DialogueEvidenceRun) => {
        r.facts[0].evidence = '伪造';
      },
      (r: DialogueEvidenceRun) => {
        r.ownerId = 'other';
      },
      (r: DialogueEvidenceRun) => {
        r.facts = Array(17).fill(r.facts[0]);
      },
    ]) {
      const r = run();
      mutate(r);
      expect(() => adaptDialogueMemorySources(r)).toThrow();
    }
  });
  it('rejects corrupted snapshot digests and role maps before accepting references', () => {
    const digest = run();
    digest.snapshot!.contentDigest = 'a'.repeat(64);
    digest.binding!.sourceDigest = digest.snapshot!.contentDigest;
    expect(() => adaptDialogueMemorySources(digest)).toThrow('DIALOGUE_SNAPSHOT_DIGEST_MISMATCH');
    const roles = run();
    roles.context!.sourceIndex['d01-m02'].role = 'student';
    expect(() => adaptDialogueMemorySources(roles)).toThrow('DIALOGUE_REFERENCE_MAP_MISMATCH');
  });
});
