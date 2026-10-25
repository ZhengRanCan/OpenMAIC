import { SECTIONS, type MemorySnapshot } from './contracts';
import { contentSize } from './prompt';

export function projectMemory(snapshot: MemorySnapshot) {
  const usable = new Set(snapshot.pieces.filter((p) => !p.restrictions.length).map((p) => p.id));
  const sections = Object.fromEntries(
    SECTIONS.map((s) => [s, snapshot.sections[s].filter((id) => usable.has(id))]),
  ) as MemorySnapshot['sections'];
  return {
    revision: snapshot.revision,
    sections,
    pieces: structuredClone(snapshot.pieces.filter((p) => usable.has(p.id))),
    restricted: snapshot.pieces
      .filter((p) => p.restrictions.length)
      .map((p) => ({ id: p.id, reasons: [...p.restrictions] })),
    size: contentSize(snapshot),
  };
}
export function renderMemory(snapshot: MemorySnapshot): string {
  const view = projectMemory(snapshot);
  return (
    SECTIONS.map(
      (s) =>
        `## ${s}\n\n` +
        (view.sections[s]
          .map((id) => {
            const p = view.pieces.find((p) => p.id === id)!;
            return `- ${p.text}\n  条件：${p.conditions.join('；') || '未记录额外条件'}\n  依据：${p.supports.map((s) => s.id + '@' + s.version.slice(0, 12)).join('、')}`;
          })
          .join('\n') || '（空）'),
    ).join('\n\n') +
    (view.restricted.length ? '\n\n部分旧片段的支持待核对，已从可用正文中排除。' : '') +
    '\n'
  );
}
