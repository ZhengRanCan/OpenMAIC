import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  canonicalJson,
  DEFAULT_BUDGETS,
  emptySnapshot,
  invariant,
  SECTIONS,
  versionSource,
  type MemorySnapshot,
  type MemorySource,
} from './contracts';
import { contentSize } from './prompt';

export const SIMULATED_STUDENTS = ['A', 'B', 'C'] as const;
export type SimulatedStudent = (typeof SIMULATED_STUDENTS)[number];
export const SIMULATED_NAMESPACE = 'f67-test:simulated-memory-v1';
export const SIMULATED_SEED_VERSION = 'simulated-memory.v1';
export const simulatedScope = (student: SimulatedStudent) => {
  invariant(SIMULATED_STUDENTS.includes(student), 'UNKNOWN_SIMULATED_STUDENT');
  return { namespace: SIMULATED_NAMESPACE, learnerKey: 'sim-' + student.toLowerCase() };
};
const documentSchema = z.object({
  version: z.literal(SIMULATED_SEED_VERSION),
  description: z.string().min(1),
  sources: z.record(
    z.string(),
    z.object({
      kind: z.enum(['declaration', 'quiz_evidence']),
      text: z.string().min(1),
      refNames: z.array(z.string()).min(1),
      conditions: z.array(z.string()),
    }),
  ),
  profiles: z.record(
    z.enum(SIMULATED_STUDENTS),
    z.object({
      label: z.string(),
      pieces: z.array(
        z.object({
          id: z.string(),
          section: z.enum(SECTIONS),
          text: z.string(),
          formation: z.enum(['declaration', 'synthesis']),
          sourceKeys: z.array(z.string()).min(1),
        }),
      ),
    }),
  ),
  demo: z.object({
    student: z.literal('C'),
    sourceKey: z.literal('past-rewrite'),
    operationId: z.string(),
  }),
});
const raw = fs.readFileSync(new URL('./simulated-seeds.json', import.meta.url), 'utf8');
const document = documentSchema.parse(JSON.parse(raw));
export const SIMULATED_SEED_SHA256 = createHash('sha256').update(raw).digest('hex');
export const SIMULATED_DEMO = document.demo;

export function simulatedSource(student: SimulatedStudent, sourceKey: string): MemorySource {
  simulatedScope(student);
  const seed = document.sources[sourceKey];
  invariant(seed, 'UNKNOWN_SIMULATED_SOURCE');
  return versionSource({
    id: `sim:${student}:${sourceKey}`,
    kind: seed.kind,
    text: seed.text,
    refs: seed.refNames.map((ref) => `fixture:simulated:${student}:${ref}`),
    conditions: [document.description, ...seed.conditions],
    sourceNature: 'synthetic',
    occurredAt: null,
    provenance: {
      file: 'OpenMAIC/lib/learner-memory/simulated-seeds.json',
      sha256: SIMULATED_SEED_SHA256,
      pointer: '/sources/' + sourceKey,
      bindings: [
        canonicalJson({
          seedVersion: document.version,
          student,
          sourceKey,
          refMapping: 'fixture:simulated:<student>:<refName>',
        }),
      ],
    },
  });
}
export function simulatedSeed(student: SimulatedStudent) {
  simulatedScope(student);
  const profile = document.profiles[student];
  const snapshot: MemorySnapshot = emptySnapshot();
  const sources = [...new Set(profile.pieces.flatMap((p) => p.sourceKeys))].map((key) =>
    simulatedSource(student, key),
  );
  for (const piece of profile.pieces) {
    const supports = piece.sourceKeys.map(
      (key) => sources.find((s) => s.id === `sim:${student}:${key}`)!,
    );
    snapshot.pieces.push({
      id: piece.id,
      text: piece.text,
      formation: piece.formation,
      supports,
      conditions: [...new Set(supports.flatMap((s) => s.conditions))],
      restrictions: [],
    });
    snapshot.sections[piece.section].push(piece.id);
  }
  snapshot.revision = snapshot.pieces.length ? 1 : 0;
  const size = contentSize(snapshot);
  invariant(
    size.total <= DEFAULT_BUDGETS.total &&
      SECTIONS.every((s) => size.sections[s] <= DEFAULT_BUDGETS.sections[s]),
    'SIMULATED_SEED_BUDGET',
  );
  return {
    student,
    label: profile.label,
    seedVersion: document.version,
    seedSha256: SIMULATED_SEED_SHA256,
    scope: simulatedScope(student),
    snapshot,
    sources,
  };
}
