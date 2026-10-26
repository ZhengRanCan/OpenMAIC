/** Recheck the old U11 failure without adopting a repaired reply. */
import fs from 'node:fs';
import { outputSchema } from '@/lib/learner-memory/contracts';
import { validateTransition } from '@/lib/learner-memory/transition';

const base = '../docs/log/artifacts/F67/';
const prior = base + 'memory-v0.3-2026-10-26/live-four-001/';
const packet = JSON.parse(fs.readFileSync(prior + 'U11.json', 'utf8'));
const reply = JSON.parse(fs.readFileSync(prior + 'U11.reply.json', 'utf8'));
const value = JSON.parse(reply.text);
const parsed = outputSchema.safeParse(value);
const copy = structuredClone(value);
for (const piece of copy.pieces) delete piece.conditions;
validateTransition(packet.run, copy);
const result = {
  classification:
    'offline diagnosis only; original reply/database unchanged; stripped copy not adopted',
  issues: parsed.success ? [] : parsed.error.issues,
  copyOnlyRemoved: ['pieces[0].conditions', 'pieces[1].conditions'],
  copyValidation: 'passed',
  newCallNeeded:
    'v0.3.1 had no nonempty piece output before this batch; offline repair cannot prove model protocol compliance',
};
fs.writeFileSync(
  base + 'memory-v0.3.1-2026-10-26/live-write-four-001/prior-u11-diagnostic.json',
  JSON.stringify(result, null, 2) + '\n',
  { flag: 'wx' },
);
console.log(JSON.stringify(result));
