/** Offline diagnosis only; never changes a captured reply or database result. */
import fs from 'node:fs';
import path from 'node:path';
import { canonicalJson, outputSchema } from '@/lib/learner-memory/contracts';
import { validateTransition } from '@/lib/learner-memory/transition';

const dir = path.resolve('../docs/log/artifacts/F67/memory-v0.3-2026-10-26/live-four-001');
const read = (name: string) => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
const packet = read('U11.json');
const original = JSON.parse(read('U11.reply.json').text);
const parsed = outputSchema.safeParse(original);
const diagnosticCopy = structuredClone(original);
for (const piece of diagnosticCopy.pieces) delete piece.conditions;
let copyValidation: unknown;
try {
  validateTransition(packet.run, diagnosticCopy);
  copyValidation = { valid: true };
} catch (error) {
  copyValidation = { valid: false, code: error instanceof Error ? error.message : 'unknown' };
}
const results = ['U02', 'U03', 'U11', 'N01'].map((caseId) => {
  const reply = read(caseId + '.reply.json');
  const patch = JSON.parse(reply.text);
  const result = read(caseId + '.result.json');
  const input = read(caseId + '.json');
  const chars = (pieces: { text: string }[]) => pieces.reduce((n, p) => n + [...p.text].length, 0);
  return {
    caseId,
    state: result.state,
    errorCode: result.errorCode,
    finishReason: reply.finishReason,
    usage: reply.usage,
    candidatePiecesChars: chars(patch.pieces),
    storedExperienceChars: chars(
      result.view.snapshot.pieces.filter((p: { id: string }) =>
        result.view.snapshot.sections.learning_experiences.includes(p.id),
      ),
    ),
    storedSnapshotUnchanged:
      canonicalJson(result.view.snapshot) === canonicalJson(input.run.snapshot),
    pending: result.view.pending,
  };
});
const report = {
  classification:
    'offline diagnostic; stripped copy never saved/adopted; original U11 remains failed',
  originalSchemaIssues: parsed.success ? [] : parsed.error.issues,
  copyOnlyRemovedFields: ['pieces[0].conditions', 'pieces[1].conditions'],
  copyValidation,
  results,
  totalTokens: results.reduce((n, r) => n + (r.usage?.totalTokens ?? 0), 0),
};
fs.writeFileSync(
  path.join(dir, 'offline-diagnostic.json'),
  JSON.stringify(report, null, 2) + '\n',
  { flag: 'wx' },
);
console.log(JSON.stringify(report));
