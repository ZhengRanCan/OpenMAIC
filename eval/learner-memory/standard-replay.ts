import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Queryable } from '@openmaic/storage/document/pg';
import { LearnerMemoryStore } from '@/lib/persistence/learner-memory-store';
import {
  canonicalJson,
  DEFAULT_BUDGETS,
  digest,
  invariant,
  outputSchema,
  SECTIONS,
  sourceKey,
  versionSource,
  type MemorySnapshot,
  type MemorySource,
  type PreparedMemoryRun,
} from '@/lib/learner-memory/contracts';

export const STANDARD_FILE = 'docs/log/artifacts/F67/memory-standard-v0.1-2026-10-25/standard.json';
const strings = z.array(z.string());
const sectionLists = z.strictObject({
  background: strings,
  goals: strings,
  teaching_requirements: strings,
  learning_experiences: strings,
});
const semanticSnapshot = z.strictObject({
  revision: z.number().int().nonnegative(),
  sections: sectionLists,
  pieces: z.array(
    z.strictObject({
      id: z.string(),
      text: z.string(),
      formation: z.enum(['declaration', 'confirmed_experience', 'synthesis']),
      sourceIds: strings,
      conditions: strings,
    }),
  ),
});
const registrySource = z
  .object({
    id: z.string(),
    kind: z.enum(['quiz_evidence', 'declaration', 'confirmed_experience']),
    text: z.string(),
    refs: strings,
    conditions: strings,
    sourceNature: z.enum(['synthetic', 'proxy']),
    occurredAt: z.string().nullable(),
    provenance: z
      .object({ file: z.string(), sha256: z.string(), pointer: z.string() })
      .passthrough(),
    version: z.string(),
  })
  .passthrough();
const standardCaseSchema = z.object({
  id: z.string(),
  scope: z.strictObject({ namespace: z.string(), learnerKey: z.string() }),
  input: z.strictObject({
    beforeMemory: semanticSnapshot,
    incomingSourceIds: strings,
    oldSourceIds: strings,
    processedSourceVersions: z.array(z.strictObject({ id: z.string(), version: z.string() })),
    maintenanceSignals: z.array(
      z.union([
        z.strictObject({
          kind: z.literal('correct_interpretation'),
          oldSourceId: z.string(),
          replacementSourceId: z.string(),
          meaning: z.string(),
        }),
        z.strictObject({
          kind: z.literal('withdraw_source'),
          sourceId: z.string(),
          meaning: z.string(),
        }),
      ]),
    ),
    budgets: z.strictObject({
      sections: z.strictObject({
        background: z.number(),
        goals: z.number(),
        teaching_requirements: z.number(),
        learning_experiences: z.number(),
      }),
      total: z.number(),
    }),
  }),
  reference: z.object({
    memory: semanticSnapshot,
    sourceDecisions: z.array(
      z.strictObject({
        sourceId: z.string(),
        action: z.enum([
          'adopt',
          'already_represented',
          'not_adopt',
          'defer',
          'already_processed',
          'restrict_existing',
        ]),
        targetPieceIds: strings,
        meaning: z.string(),
      }),
    ),
    noModelCallExpected: z.boolean(),
  }),
});
export type StandardCase = z.infer<typeof standardCaseSchema>;
type SemanticSnapshot = z.infer<typeof semanticSnapshot>;
export interface StandardCorpus {
  cases: StandardCase[];
  sources: Record<string, MemorySource>;
  versions: Record<string, { registry: string; runtime: string }>;
  standardSha256: string;
}
const sha = (text: string) => createHash('sha256').update(text).digest('hex');

/** A valid file hash alone does not prove that a registry text matches the cited record. */
export function verifyStandardOrigin(
  source: Pick<MemorySource, 'id' | 'text' | 'refs'>,
  document: unknown,
  pointer: string,
) {
  invariant(pointer.startsWith('/'), 'STANDARD_SOURCE_POINTER');
  let record: unknown = document;
  for (const segment of pointer.slice(1).split('/')) {
    const key = segment.replaceAll('~1', '/').replaceAll('~0', '~');
    invariant(
      record !== null && typeof record === 'object' && Object.hasOwn(record, key),
      'STANDARD_SOURCE_POINTER',
    );
    record = (record as Record<string, unknown>)[key];
  }
  const entry = z
    .object({
      id: z.string().optional(),
      text: z.string().optional(),
      evidence: z.string().optional(),
      refs: strings.optional(),
    })
    .parse(record);
  invariant((entry.evidence ?? entry.text) === source.text, 'STANDARD_SOURCE_TEXT');
  invariant(!entry.id || entry.id === source.id, 'STANDARD_SOURCE_ID');
  const refs = entry.refs ?? (entry.id ? ['fixture:' + entry.id] : undefined);
  invariant(refs && canonicalJson(refs) === canonicalJson(source.refs), 'STANDARD_SOURCE_REFS');
}

/** Authored reference fixtures only. Loading this corpus does not approve its semantic labels. */
export function loadStandardCorpus(
  workspace: string,
  relativeFile = STANDARD_FILE,
): StandardCorpus {
  const artifactRoot =
    fs.realpathSync(path.resolve(workspace, 'docs/log/artifacts/F67')) + path.sep;
  const standardFile = fs.realpathSync(path.resolve(workspace, relativeFile));
  invariant(standardFile.startsWith(artifactRoot), 'STANDARD_CORPUS_PATH');
  const raw = fs.readFileSync(standardFile, 'utf8');
  const parsed = z
    .object({
      semanticApproved: z.literal(false),
      sources: z.record(z.string(), registrySource),
      cases: z.array(standardCaseSchema),
    })
    .parse(JSON.parse(raw));
  const sources: Record<string, MemorySource> = {};
  const versions: StandardCorpus['versions'] = {};
  const docsRoot = fs.realpathSync(path.resolve(workspace, 'docs')) + path.sep;
  for (const [id, source] of Object.entries(parsed.sources)) {
    const { version, ...entry } = source;
    invariant(source.id === id && digest(entry) === version, 'STANDARD_SOURCE_VERSION');
    // Verify the sealed evidence/fixture file before accepting its provenance.
    const file = fs.realpathSync(path.resolve(workspace, source.provenance.file));
    invariant(file.startsWith(docsRoot), 'STANDARD_SOURCE_PATH');
    const originText = fs.readFileSync(file, 'utf8');
    invariant(sha(originText) === source.provenance.sha256, 'STANDARD_SOURCE_HASH');
    verifyStandardOrigin(source, JSON.parse(originText), source.provenance.pointer);
    sources[id] = versionSource({
      id,
      kind: source.kind,
      text: source.text,
      refs: source.refs,
      conditions: source.conditions,
      sourceNature: source.sourceNature,
      occurredAt: source.occurredAt,
      provenance: {
        file: source.provenance.file,
        sha256: source.provenance.sha256,
        pointer: source.provenance.pointer,
        // Registry schema and runtime schema differ. Preserve the complete registry entry,
        // including its original version, rather than pretending their hashes are equal.
        bindings: [canonicalJson(source)],
      },
    });
    versions[id] = { registry: version, runtime: sources[id].version };
  }
  return { cases: parsed.cases, sources, versions, standardSha256: sha(raw) };
}

export function runtimeSnapshot(
  snapshot: SemanticSnapshot,
  sources: StandardCorpus['sources'],
): MemorySnapshot {
  return {
    schemaVersion: 1,
    revision: snapshot.revision,
    sections: structuredClone(snapshot.sections),
    pieces: snapshot.pieces.map((piece) => {
      const supports = piece.sourceIds.map((id) => {
        invariant(sources[id], 'STANDARD_SOURCE_UNKNOWN');
        return structuredClone(sources[id]);
      });
      const conditions = [...new Set(supports.flatMap((source) => source.conditions))];
      invariant(
        canonicalJson(conditions) === canonicalJson(piece.conditions),
        'STANDARD_CONDITIONS',
      );
      return {
        id: piece.id,
        text: piece.text,
        formation: piece.formation,
        supports,
        conditions,
        restrictions: [],
      };
    }),
  };
}

export interface IsolatedStandardFixture {
  db: Queryable;
  store: LearnerMemoryStore;
  /** Caller must own a disposable PGlite database or a dedicated random PostgreSQL test schema. */
  isolatedDatabase: true;
}
type StandardInput = Pick<StandardCase, 'id' | 'scope' | 'input'>;

/** Test-only seed. Intentionally absent from the production store API. */
export async function seedStandardInput(
  fixture: IsolatedStandardFixture,
  corpus: Pick<StandardCorpus, 'sources' | 'versions'>,
  test: StandardInput,
) {
  invariant(fixture.isolatedDatabase === true, 'STANDARD_ISOLATION_REQUIRED');
  invariant(
    ['f67-test:standard-', 'f67-test:negative-'].some(
      (prefix) => test.scope.namespace === prefix + test.id,
    ),
    'STANDARD_SCOPE_REQUIRED',
  );
  const keys = [test.scope.namespace, test.scope.learnerKey];
  const snapshot = runtimeSnapshot(test.input.beforeMemory, corpus.sources);
  await fixture.db.query(
    'INSERT INTO learner_memory_states(namespace,learner_key,snapshot) VALUES($1,$2,$3::jsonb)',
    [...keys, JSON.stringify(snapshot)],
  );
  await fixture.store.ingest(
    test.scope,
    test.input.oldSourceIds.map((id) => {
      invariant(corpus.sources[id], 'STANDARD_SOURCE_UNKNOWN');
      return corpus.sources[id];
    }),
  );
  for (const processed of test.input.processedSourceVersions) {
    invariant(
      corpus.versions[processed.id]?.registry === processed.version,
      'STANDARD_PROCESSED_VERSION',
    );
    const update = await fixture.db.query(
      'UPDATE learner_memory_sources SET processed=true WHERE namespace=$1 AND learner_key=$2 AND source_id=$3 AND version=$4 RETURNING source_id',
      [...keys, processed.id, corpus.versions[processed.id].runtime],
    );
    invariant(update.rows.length === 1, 'STANDARD_PROCESSED_SOURCE_MISSING');
  }
}

/** Input-only boundary: this function has no reference or rubric parameter. */
export async function prepareStandardInput(
  fixture: IsolatedStandardFixture,
  corpus: Pick<StandardCorpus, 'sources' | 'versions'>,
  test: StandardInput,
  operationId = 'standard-first',
) {
  await seedStandardInput(fixture, corpus, test);
  for (const signal of test.input.maintenanceSignals) {
    const id = signal.kind === 'withdraw_source' ? signal.sourceId : signal.oldSourceId;
    await fixture.store.restrictSource(test.scope, id, signal.meaning);
  }
  await fixture.store.ingest(
    test.scope,
    test.input.incomingSourceIds.map((id) => {
      invariant(corpus.sources[id], 'STANDARD_SOURCE_UNKNOWN');
      return corpus.sources[id];
    }),
  );
  return fixture.store.prepare(test.scope, operationId, {
    ...DEFAULT_BUDGETS,
    ...test.input.budgets,
  });
}

/** Deterministic authored Patch for mechanical reference replay; never used for model input. */
export function patchFromReference(
  run: PreparedMemoryRun,
  test: StandardCase,
  sources: StandardCorpus['sources'],
) {
  const target = runtimeSnapshot(test.reference.memory, sources);
  const oldIds = new Set(run.snapshot.pieces.map((piece) => piece.id));
  const idMap = new Map(
    target.pieces.map((piece, i) => [piece.id, oldIds.has(piece.id) ? piece.id : 'new:' + (i + 1)]),
  );
  const idFor = (id: string) => {
    invariant(idMap.has(id), 'STANDARD_TARGET_ID');
    return idMap.get(id)!;
  };
  const changed = target.pieces.filter((piece) => {
    const old = run.snapshot.pieces.find((p) => p.id === piece.id);
    return !old || canonicalJson(old) !== canonicalJson(piece);
  });
  const changedIds = new Set(changed.map((piece) => piece.id));
  const sections = SECTIONS.filter(
    (section) =>
      canonicalJson(run.snapshot.sections[section]) !== canonicalJson(target.sections[section]) ||
      target.sections[section].some((id) => changedIds.has(id)),
  ).map((section) => ({ section, pieceIds: target.sections[section].map(idFor) }));
  const aliasFor = (source: MemorySource) => {
    const alias = Object.keys(run.aliases).find(
      (alias) => sourceKey(run.aliases[alias]) === sourceKey(source),
    );
    invariant(alias, 'STANDARD_ALIAS_MISSING');
    return alias;
  };
  const retired = SECTIONS.flatMap((section) =>
    run.snapshot.sections[section]
      .filter((id) => !target.sections[section].includes(id))
      .map((id) => {
        const old = run.snapshot.pieces.find((piece) => piece.id === id)!;
        const replacements = target.pieces.filter(
          (piece) =>
            target.sections[section].includes(piece.id) &&
            piece.supports.some((support) =>
              old.supports.some((s) => sourceKey(s) === sourceKey(support)),
            ),
        );
        return {
          id,
          section,
          action: old.restrictions.length
            ? 'withdraw'
            : replacements.length
              ? 'merge'
              : 'budget_remove',
          replacements: replacements.map((piece) => idFor(piece.id)),
          reason: '人工参考fixture维护；不代表模型已完成语义判断',
        };
      }),
  );
  return outputSchema.parse({
    status: 'ready',
    sections,
    pieces: changed.map((piece) => ({
      id: idFor(piece.id),
      text: piece.text,
      formation: piece.formation,
      supports: piece.supports.map(aliasFor),
    })),
    retired,
    decisions: Object.entries(run.aliases)
      .filter(([alias]) => alias.startsWith('e'))
      .map(([alias, source]) => {
        const decision = test.reference.sourceDecisions.find((d) => d.sourceId === source.id);
        invariant(
          decision &&
            ['adopt', 'already_represented', 'not_adopt', 'defer'].includes(decision.action),
          'STANDARD_DECISION',
        );
        return {
          source: alias,
          action: decision.action,
          pieceIds: decision.targetPieceIds.map(idFor),
          reason: decision.meaning,
        };
      }),
  });
}

/** IDs/revision are operational; compare full persisted meanings, supports and conditions by view. */
export function normalizeStandardMemory(snapshot: Pick<MemorySnapshot, 'sections' | 'pieces'>) {
  return Object.fromEntries(
    SECTIONS.map((section) => [
      section,
      snapshot.sections[section].map((id) => {
        const piece = snapshot.pieces.find((p) => p.id === id);
        invariant(piece, 'STANDARD_NORMALIZE_ID');
        return {
          text: piece.text,
          formation: piece.formation,
          supports: [...piece.supports].sort((a, b) => sourceKey(a).localeCompare(sourceKey(b))),
          conditions: [...piece.conditions].sort(),
          restrictions: [...piece.restrictions].sort(),
        };
      }),
    ]),
  );
}

export async function replayStandardReference(
  fixture: IsolatedStandardFixture,
  corpus: StandardCorpus,
  test: StandardCase,
) {
  const prepared = await prepareStandardInput(fixture, corpus, test);
  const restrictedBeforeReply = await fixture.store.read(test.scope);
  let failedMaintenanceState: Awaited<ReturnType<LearnerMemoryStore['read']>> | undefined;
  let run = prepared;
  // A failed generation must not expose withdrawn content; exercise it before successful maintenance.
  if (test.input.maintenanceSignals.some((signal) => signal.kind === 'withdraw_source')) {
    await fixture.store.capture(test.scope, run.id, {
      text: '{',
      finishReason: 'stop',
      model: 'manual-invalid-fixture',
      origin: 'manual',
      usage: null,
    });
    const failed = await fixture.store.commit(test.scope, run.id);
    invariant(failed.state === 'failed', 'STANDARD_EXPECTED_MAINTENANCE_FAILURE');
    failedMaintenanceState = await fixture.store.read(test.scope);
    invariant(
      canonicalJson(normalizeStandardMemory(failedMaintenanceState.usable)) ===
        canonicalJson(normalizeStandardMemory(restrictedBeforeReply.usable)),
      'STANDARD_FAILED_RESTRICTION_CHANGED',
    );
    run = await fixture.store.prepare(test.scope, 'standard-after-failure', run.budgets);
  }
  const patch = run.state === 'noop' ? null : patchFromReference(run, test, corpus.sources);
  if (patch) {
    await fixture.store.capture(test.scope, run.id, {
      text: JSON.stringify(patch),
      finishReason: 'stop',
      model: 'manual-reference-fixture',
      origin: 'manual',
      usage: null,
    });
    run = await fixture.store.commit(test.scope, run.id);
    invariant(run.state === 'completed', 'STANDARD_COMMIT_' + (run.errorCode ?? run.state));
  }
  const saved = await fixture.store.read(test.scope);
  const expected = runtimeSnapshot(test.reference.memory, corpus.sources);
  invariant(
    canonicalJson(normalizeStandardMemory(saved.usable)) ===
      canonicalJson(normalizeStandardMemory(expected)),
    'STANDARD_REFERENCE_MISMATCH',
  );
  invariant(
    saved.coverage
      .filter((source) => source.current && source.valid)
      .every((source) => source.processed),
    'STANDARD_UNPROCESSED',
  );
  await fixture.store.ingest(
    test.scope,
    test.input.incomingSourceIds.map((id) => corpus.sources[id]),
  );
  const repeat = await fixture.store.prepare(test.scope, 'standard-repeat', run.budgets);
  invariant(repeat.state === 'noop', 'STANDARD_REPEAT_NOT_NOOP');
  const repeated = await fixture.store.read(test.scope);
  invariant(canonicalJson(saved) === canonicalJson(repeated), 'STANDARD_REPEAT_CHANGED');
  return {
    caseId: test.id,
    verification: 'authored-reference mechanical replay; not model semantic acceptance',
    modelCalls: 0,
    prompt: prepared.prompt,
    runState: run.state,
    patch,
    saved,
    restrictedBeforeReply,
    failedMaintenanceState,
    repeatState: repeat.state,
    noModelCallExpected: test.reference.noModelCallExpected,
    standardSha256: corpus.standardSha256,
  };
}
