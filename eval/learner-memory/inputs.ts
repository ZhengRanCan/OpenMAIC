import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { invariant, versionSource, type MemorySource } from '@/lib/learner-memory/contracts';

const ROOT = 'docs/log/artifacts/F64/';
const BASE = ROOT + 'memory-evidence-v0.1-2026-10-24/';
export const GOLD_FILE = ROOT + 'memory-evidence-standard-v0.2-2026-10-24/gold.json';
export const GOLD_HASH = '9342695c8253355da617c9d1f9dd64c8cd5a6520955f609463de955ae5860d84';
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const stable = (v: unknown): string =>
  JSON.stringify(v, (_k, x) =>
    x && typeof x === 'object' && !Array.isArray(x)
      ? Object.fromEntries(
          Object.keys(x)
            .sort()
            .map((k) => [k, x[k]]),
        )
      : x,
  );
const fact = z.strictObject({
  type: z.enum([
    'correct_performance',
    'error_performance',
    'error_pattern',
    'performance_contrast',
  ]),
  evidence: z.string().refine((s) => [...s].length > 0 && [...s].length <= 240),
  refs: z.array(z.string()).min(1),
});
const packetSchema = z.object({
  packetSha256: z.string(),
  sourceBinding: z.object({ inputFile: z.string(), inputSha256: z.string() }),
  references: z.record(
    z.string(),
    z
      .object({ inputPath: z.string(), submissionId: z.string(), versionId: z.string() })
      .passthrough(),
  ),
  context: z.object({
    submissions: z.array(
      z.object({
        binding: z.object({ submissionId: z.string(), versionId: z.string() }),
        conditions: z.object({ personalLearnerEvidence: z.literal(false) }).passthrough(),
      }),
    ),
  }),
});
export interface MemoryCase {
  caseId: string;
  sources: MemorySource[];
  origin: 'manual' | 'real';
  sealedFiles: Record<string, string>;
}

export function loadMemoryCases(workspace: string, mode: 'manual' | 'real'): MemoryCase[] {
  const sealed: Record<string, string> = {};
  const read = (relative: string, expected?: string): string => {
    invariant(relative.startsWith(ROOT), 'SOURCE_PATH');
    const file = fs.realpathSync(path.resolve(workspace, relative));
    const boundary = fs.realpathSync(path.resolve(workspace, ROOT)) + path.sep;
    invariant(file.startsWith(boundary), 'SOURCE_PATH');
    const text = fs.readFileSync(file, 'utf8'),
      hash = sha(text);
    invariant(!expected || hash === expected, 'SOURCE_HASH_MISMATCH');
    sealed[relative] = hash;
    return text;
  };
  const gold = z
    .object({
      cases: z.array(
        z.object({
          caseId: z.string(),
          examples: z.object({
            positive: z.array(
              z.object({ id: z.string(), output: z.strictObject({ facts: z.array(fact) }) }),
            ),
          }),
        }),
      ),
    })
    .parse(JSON.parse(read(GOLD_FILE, GOLD_HASH)));
  const frozen = z
    .object({ files: z.record(z.string(), z.string()) })
    .parse(JSON.parse(read(ROOT + 'closeout-2026-10-24/baseline.json')));
  const cases =
    mode === 'manual'
      ? gold.cases.map((c, i) => {
          invariant(c.examples.positive.length === 1, 'POSITIVE_COUNT');
          return {
            id: c.caseId,
            facts: c.examples.positive[0].output.facts,
            file: GOLD_FILE,
            hash: GOLD_HASH,
            pointer: '/cases/' + i + '/examples/positive/0/output/facts',
          };
        })
      : ['N02', 'N03', 'N04', 'N05'].map((id) => {
          const file = BASE + 'probes/task-entry-four-001/' + id + '.output.json';
          invariant(frozen.files[file], 'UNSEALED_REAL_OUTPUT');
          const output = z
            .object({
              caseId: z.literal(id),
              candidateStatus: z.literal('unreviewed'),
              adoptionAllowed: z.literal(false),
              validation: z.object({
                status: z.literal('complete'),
                accepted: z.array(z.object({ sourceIndex: z.number().int(), fact })),
                rejected: z.array(z.unknown()).length(0),
              }),
            })
            .parse(JSON.parse(read(file, frozen.files[file])));
          return {
            id,
            facts: output.validation.accepted.map((a) => a.fact),
            file,
            hash: sealed[file],
            pointer: '/validation/accepted',
          };
        });
  return cases.map((c) => {
    const packetFile = BASE + 'batches/user-edited-12-001/' + c.id + '.packet.json';
    const raw = JSON.parse(read(packetFile)) as Record<string, unknown>;
    const { packetSha256, ...rest } = raw;
    invariant(sha(stable(rest)) === packetSha256, 'PACKET_HASH');
    const packet = packetSchema.parse(raw);
    read(packet.sourceBinding.inputFile, packet.sourceBinding.inputSha256);
    const sources = c.facts.map((f, i) => {
      const conditions: string[] = [];
      const bindings = f.refs.map((ref) => {
        const r = packet.references[ref];
        invariant(r, 'REF_NOT_BOUND');
        invariant(ref.startsWith('quiz:' + c.id + ':'), 'REF_CASE_CONFLICT');
        const submission = packet.context.submissions.find(
          (s) => s.binding.submissionId === r.submissionId && s.binding.versionId === r.versionId,
        );
        invariant(submission, 'REF_SUBMISSION_CONFLICT');
        conditions.push(JSON.stringify(submission.conditions));
        return JSON.stringify({ ref, ...r, ...packet.sourceBinding, packetFile, packetSha256 });
      });
      if (mode === 'real')
        conditions.push('上游模型候选，candidateStatus=unreviewed；未由程序认证含义。');
      return versionSource({
        id: c.id + ':' + mode + ':fact-' + i,
        kind: 'quiz_evidence',
        text: f.evidence,
        refs: f.refs,
        conditions: [...new Set(conditions)],
        sourceNature: c.id.startsWith('legacy-') ? 'proxy' : 'synthetic',
        occurredAt: null,
        provenance: {
          file: c.file,
          sha256: c.hash,
          pointer: c.pointer + '/' + i + (mode === 'real' ? '/fact' : ''),
          bindings: [JSON.stringify({ evidenceType: f.type }), ...bindings],
        },
      });
    });
    return { caseId: c.id, sources, origin: mode, sealedFiles: { ...sealed } };
  });
}
