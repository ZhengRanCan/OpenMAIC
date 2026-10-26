import {
  DEFAULT_BUDGETS,
  emptySnapshot,
  versionSource,
  type PreparedMemoryRun,
} from '@/lib/learner-memory/contracts';
import { buildMemoryPrompt } from '@/lib/learner-memory/prompt';

export function source() {
  return {
    id: 'evidence-1',
    kind: 'quiz_evidence',
    text: '在公式提示下计算正确，但换算错误。',
    refs: ['quiz:N04:S1:q3'],
    conditions: ['synthetic; not personal evidence'],
    sourceNature: 'synthetic',
    occurredAt: null,
    provenance: { file: 'fixture.json', sha256: 'a'.repeat(64), pointer: '/facts/0' },
  };
}
export function runFixture(): PreparedMemoryRun {
  const batch = [versionSource(source())],
    snapshot = emptySnapshot();
  return {
    id: 'op',
    scope: { namespace: 'f67-test:unit', learnerKey: 'N04' },
    state: 'prepared',
    baseRevision: 0,
    snapshot,
    batch,
    budgets: DEFAULT_BUDGETS,
    ...buildMemoryPrompt(snapshot, batch, DEFAULT_BUDGETS, []),
    createdAt: new Date().toISOString(),
  };
}
export function response() {
  return {
    status: 'ready',
    sections: [{ section: 'learning_experiences', pieceIds: ['new:1'] }],
    pieces: [
      {
        id: 'new:1',
        text: '在公式提示下计算正确，但换算错误。',
        formation: 'synthesis',
        supports: ['e1'],
      },
    ],
    retired: [],
    decisions: [{ source: 'e1', action: 'adopt', pieceIds: ['new:1'], reason: '具体经历可供接续' }],
  };
}
