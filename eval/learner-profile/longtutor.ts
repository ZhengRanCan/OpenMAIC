import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { digest } from '@/lib/learner-memory/contracts';
import { validateInputs } from './engine';
import type { Event, Question } from './contracts';

const itemSchema = z.object({
  question: z.string(),
  response: z.union([z.literal(0), z.literal(1)]),
  timestamp: z.string().nullable().optional(),
});
const bankSchema = z.object({
  id: z.string(),
  info: z.object({
    content: z.string(),
    type: z.string(),
    options: z.record(z.string(), z.string()),
    concepts: z.array(z.string()),
  }),
});
const sequenceSchema = z.object({
  uid: z.union([z.string(), z.number()]).transform(String),
  sequence: z.array(itemSchema).min(2),
});
const goldSchema = z.object({
  _key: z.string(),
  memory: z
    .array(
      z.object({ id: z.string().optional(), query: z.string().min(1), answer: z.string().min(1) }),
    )
    .length(3),
});
type Info = z.infer<typeof bankSchema>['info'];
type Item = z.infer<typeof itemSchema>;

async function* jsonl(path: string) {
  const stream = createReadStream(path, { encoding: 'utf8' });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of lines)
      if (line.trim()) yield JSON.parse(line.replace(/^\uFEFF/, '')) as unknown;
  } finally {
    lines.close();
    stream.destroy();
  }
}
async function fileHash(path: string) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

/** Exact XES renderer from the pinned official data_processing.py. Whitespace is part of the join key. */
export function conceptSegments(concepts: string[]) {
  return [
    ...new Set(
      concepts.flatMap((c) =>
        c
          .split('----')
          .slice(1)
          .map((p) => p.trim())
          .filter(Boolean),
      ),
    ),
  ];
}

/** Model-visible task context: no current response or observation time. */
export function renderCurrentTaskContext(info: Info, item: Pick<Item, 'question'>) {
  const segments = conceptSegments(info.concepts);
  const lines = [`[${item.question}]`];
  if (info.content) lines.push(`${info.type}: ${info.content}`);
  if (Object.keys(info.options).length)
    lines.push(
      Object.entries(info.options)
        .map(([k, v]) => `${k}: ${v}`)
        .join('; '),
    );
  lines.push(`知识点: ${segments.length ? segments.join(', ') : '[]'}`);
  return lines.join('\n');
}

/** Keep the exact official bytes exclusively for joining Gold, never for answer input. */
export function renderQuestion(info: Info, item: Item) {
  const lines = [renderCurrentTaskContext(info, item)];
  if (item.timestamp) lines.push(`时间: ${item.timestamp}`);
  lines.push(`结果: ${item.response === 1 ? '正确' : '错误'}`);
  return lines.join('\n');
}
export const goldKey = (uid: string, rendered: string) =>
  `${uid}||${createHash('sha256').update(rendered, 'utf8').digest('hex')}`;

export async function importLongTutor(
  sequences: string,
  questions: string,
  gold: string,
  limit: number,
) {
  const bank = new Map<string, Info>(),
    refs = new Map<string, z.infer<typeof goldSchema>>();
  for await (const raw of jsonl(questions)) {
    const row = bankSchema.parse(raw);
    if (bank.has(row.id)) throw new Error('QUESTION_BANK_DUPLICATE');
    bank.set(row.id, row.info);
  }
  for await (const raw of jsonl(gold)) {
    const row = goldSchema.parse(raw);
    if (refs.has(row._key)) throw new Error('GOLD_KEY_DUPLICATE');
    refs.set(row._key, row);
  }
  const events: Event[] = [],
    qas: Question[] = [];
  const used = new Set<string>();
  let scanned = 0,
    matched = 0,
    unmatched = 0,
    missingQuestions = 0,
    naiveTimes = 0;
  for await (const raw of jsonl(sequences)) {
    const row = sequenceSchema.parse(raw);
    scanned++;
    const current = row.sequence.at(-1)!,
      info = bank.get(current.question);
    if (!info) {
      missingQuestions++;
      continue;
    }
    const rendered = renderQuestion(info, current),
      key = goldKey(row.uid, rendered),
      reference = refs.get(key);
    if (!reference) {
      unmatched++;
      continue;
    }
    const learnerId = `lt-${digest(row.uid).slice(0, 20)}`;
    if (used.has(learnerId)) throw new Error('LEARNER_DUPLICATE');
    used.add(learnerId);
    const history: Event[] = [];
    for (const [i, item] of row.sequence.slice(0, -1).entries()) {
      const q = bank.get(item.question);
      if (!q) {
        missingQuestions++;
        break;
      }
      const zoned =
        item.timestamp && /([zZ]|[+-]\d\d:\d\d)$/.test(item.timestamp)
          ? new Date(item.timestamp).toISOString()
          : null;
      if (item.timestamp && !zoned) naiveTimes++;
      history.push({
        id: `history-${i + 1}`,
        learnerId,
        ordinal: i + 1,
        occurredAt: zoned,
        kind: 'quiz',
        origin: 'public',
        questionId: item.question,
        concepts: conceptSegments(q.concepts),
        recordedTime: item.timestamp ?? undefined,
        parts: [
          {
            question: `${q.type}: ${q.content}`,
            options: Object.entries(q.options).map(([k, v]) => `${k}: ${v}`),
            review: item.response ? 'correct' : 'incorrect',
            help: 'unknown',
          },
        ],
      });
    }
    if (history.length !== row.sequence.length - 1) continue;
    events.push(...history);
    for (const [i, memory] of reference.memory.entries()) {
      if (memory.id && memory.id !== `Q${i + 1}`) throw new Error('GOLD_QUERY_ORDER_INVALID');
      qas.push({
        id: `Q${i + 1}`,
        learnerId,
        category: (['IE', 'MR', 'HC'] as const)[i],
        question: `当前题（不属于历史回放，未提供作答、结果和标准答案）：\n${renderCurrentTaskContext(info, current)}\n历史问题：${memory.query}`,
        gold: memory.answer,
        sourceIds: [],
      });
    }
    matched++;
    if (matched >= limit) break;
  }
  if (!matched) throw new Error('NO_GOLD_ASSOCIATIONS');
  validateInputs(events, qas);
  return {
    events,
    questions: qas,
    manifest: {
      source: 'liano3/LongTutor',
      referenceCommit: 'ba40af3b9e976f5960c42a15a645c0e9c3a7d718',
      hashes: {
        sequences: await fileHash(sequences),
        bank: await fileHash(questions),
        gold: await fileHash(gold),
      },
      scanned,
      matched,
      requested: limit,
      unmatched,
      missingQuestions,
      historyEvents: events.length,
      queries: qas.length,
      naiveTimes,
      scope:
        'Scanned prefix only, not a full-dataset match-rate audit. Adapted samples are development data.',
      missing: ['actual learner answer', 'help process'],
      timePolicy:
        'Preserve original text; no timezone inferred. Replay uses original sequence ordinal.',
      scoring: 'Local semantic judge; official reference answers preserved unchanged.',
      adapterVersion: 'longtutor-history-v2-no-current-outcome',
      externalModelProcessing: false,
    },
  };
}
