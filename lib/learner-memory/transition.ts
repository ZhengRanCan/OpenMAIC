import { randomUUID } from 'node:crypto';
import {
  invariant,
  outputSchema,
  SECTIONS,
  sourceKey,
  type MemoryPiece,
  type PreparedMemoryRun,
  type MemoryDecision,
} from './contracts';
import { contentSize } from './prompt';

const unique = (values: string[], code: string) =>
  invariant(new Set(values).size === values.length, code);
export function validateTransition(run: PreparedMemoryRun, value: unknown) {
  const output = outputSchema.parse(value);
  invariant(output.status === 'ready', 'CAPACITY_EXCEEDED');
  const snapshot = structuredClone(run.snapshot);
  unique(
    output.sections.map((s) => s.section),
    'DUPLICATE_SECTION',
  );
  unique(
    output.pieces.map((p) => p.id),
    'DUPLICATE_PIECE',
  );
  unique(
    output.decisions.map((d) => d.source),
    'DUPLICATE_DECISION',
  );
  unique(
    output.retired.map((r) => r.section + ':' + r.id),
    'DUPLICATE_RETIREMENT',
  );
  const changedSections = new Set(output.sections.map((s) => s.section));
  const oldIds = new Set(snapshot.pieces.map((p) => p.id));
  const ids = new Map<string, string>();
  for (const p of output.pieces) {
    invariant(oldIds.has(p.id) || /^new:[1-9]\d*$/.test(p.id), 'UNKNOWN_PIECE_ID');
    ids.set(p.id, oldIds.has(p.id) ? p.id : randomUUID());
    const sources = p.supports.map((alias) => {
      invariant(run.aliases[alias], 'UNKNOWN_SOURCE');
      return run.aliases[alias];
    });
    unique(sources.map(sourceKey), 'DUPLICATE_SUPPORT');
    if (p.formation === 'declaration')
      invariant(
        sources.every((s) => s.kind === 'declaration'),
        'FALSE_DECLARATION',
      );
    if (p.formation === 'confirmed_experience')
      invariant(
        sources.every((s) => s.kind === 'confirmed_experience'),
        'FALSE_CONFIRMATION',
      );
    const conditions = [...new Set(sources.flatMap((s) => s.conditions))];
    invariant(
      p.conditions.every((c) => conditions.includes(c)),
      'INVENTED_CONDITION',
    );
    if (oldIds.has(p.id))
      for (const section of SECTIONS)
        if (snapshot.sections[section].includes(p.id))
          invariant(changedSections.has(section), 'SHARED_PIECE_SECTION_OMITTED');
    const piece: MemoryPiece = {
      id: ids.get(p.id)!,
      text: p.text,
      formation: p.formation,
      supports: structuredClone(sources),
      conditions,
      restrictions: [],
    };
    snapshot.pieces = snapshot.pieces.filter((x) => x.id !== p.id);
    snapshot.pieces.push(piece);
  }
  const resolve = (id: string) => ids.get(id) ?? id;
  for (const s of output.sections) {
    unique(s.pieceIds, 'DUPLICATE_SECTION_PIECE');
    for (const id of s.pieceIds) {
      const piece = snapshot.pieces.find((p) => p.id === resolve(id));
      invariant(piece, 'UNKNOWN_SECTION_PIECE');
      // Restricted fragments may stay in unchanged sections for audit, not be re-adopted.
      invariant(piece.restrictions.length === 0, 'RESTRICTED_PIECE_REUSED');
    }
    snapshot.sections[s.section] = s.pieceIds.map(resolve);
  }
  for (const section of SECTIONS)
    for (const oldId of run.snapshot.sections[section]) {
      const removed = !snapshot.sections[section].includes(oldId);
      const r = output.retired.find((r) => r.id === oldId && r.section === section);
      invariant(removed === !!r, 'OLD_PIECE_DISPOSITION');
      if (r) {
        invariant(r.action !== 'merge' || r.replacements.length > 0, 'MERGE_TARGET_REQUIRED');
        for (const id of r.replacements)
          invariant(snapshot.sections[section].includes(resolve(id)), 'INVALID_RETIREMENT_TARGET');
      }
    }
  for (const r of output.retired)
    invariant(run.snapshot.sections[r.section].includes(r.id), 'UNKNOWN_RETIRED_PIECE');
  const used = new Set(Object.values(snapshot.sections).flat());
  for (const p of output.pieces) invariant(used.has(resolve(p.id)), 'ORPHAN_PIECE');
  snapshot.pieces = snapshot.pieces.filter((p) => used.has(p.id));
  invariant(snapshot.pieces.length <= 64, 'MEMORY_PIECE_CAPACITY');
  const batchAliases = Object.keys(run.aliases).filter((k) => k.startsWith('e'));
  invariant(
    output.decisions.length === batchAliases.length &&
      output.decisions.every((d) => batchAliases.includes(d.source)),
    'BATCH_COVERAGE',
  );
  const decisions: MemoryDecision[] = output.decisions.map((d) => {
    unique(d.pieceIds, 'DUPLICATE_DECISION_PIECE');
    const pieceIds = d.pieceIds.map(resolve);
    invariant(
      pieceIds.every((id) => used.has(id)),
      'UNKNOWN_DECISION_PIECE',
    );
    if (d.action === 'adopt' || d.action === 'already_represented')
      invariant(pieceIds.length > 0, 'DECISION_TARGET_REQUIRED');
    else invariant(pieceIds.length === 0, 'NON_ADOPTION_TARGET');
    for (const id of pieceIds) {
      const p = snapshot.pieces.find((p) => p.id === id)!;
      invariant(!p.restrictions.length, 'RESTRICTED_DECISION_TARGET');
      if (d.action === 'adopt')
        invariant(
          p.supports.some((s) => sourceKey(s) === sourceKey(run.aliases[d.source])),
          'ADOPTION_SUPPORT_MISSING',
        );
    }
    return { ...d, pieceIds };
  });
  // A deferred/rejected increment cannot quietly be adopted through a piece definition.
  for (const p of output.pieces)
    for (const alias of p.supports.filter((a) => a.startsWith('e'))) {
      const d = output.decisions.find((d) => d.source === alias)!;
      invariant(d?.action === 'adopt' && d.pieceIds.includes(p.id), 'UNDECLARED_ADOPTION');
    }
  const size = contentSize(snapshot);
  for (const section of SECTIONS)
    invariant(size.sections[section] <= run.budgets.sections[section], 'SECTION_BUDGET_EXCEEDED');
  invariant(size.total <= run.budgets.total, 'TOTAL_BUDGET_EXCEEDED');
  snapshot.revision++;
  return { snapshot, decisions, retired: output.retired };
}
