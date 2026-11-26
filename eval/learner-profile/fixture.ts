import { SECTIONS } from '@/lib/learner-memory/contracts';
import type { prepareClassroomMemory } from '@/lib/learner-memory/classroom-transition';

/** Deterministic transport fixture, not a student simulator or an accuracy baseline. */
export function fixtureMemory(run: ReturnType<typeof prepareClassroomMemory>) {
  const pieces: Array<{ id: string; text: string; formation: 'synthesis'; supports: string[] }> =
    [];
  const decisions = [];
  const sections = new Map(SECTIONS.map((s) => [s, [...run.snapshot.sections[s]]]));
  for (const [i, s] of run.batch.entries()) {
    const alias = `e${i + 1}`,
      id = `new:${i + 1}`;
    const section = s.refs[0] === 'qa' ? 'goals' : 'learning_experiences';
    const value = JSON.parse(s.text);
    if (value.worthRetaining === false) {
      decisions.push({ source: alias, action: 'not_adopt', pieceIds: [], reason: 'fixture' });
      continue;
    }
    const text = String(
      value.extractedFact ?? value.answer ?? `${value.question}：${value.review}`,
    ).slice(0, 160);
    pieces.push({ id, text, formation: 'synthesis', supports: [alias] });
    sections.get(section)!.push(id);
    decisions.push({
      source: alias,
      action: 'adopt',
      pieceIds: [id],
      reason: 'fixture protocol probe',
    });
  }
  return JSON.stringify({
    status: 'ready',
    sections: [...sections].map(([section, pieceIds]) => ({ section, pieceIds })),
    pieces,
    decisions,
    retired: [],
  });
}
