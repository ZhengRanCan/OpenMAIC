import { DEFAULT_BUDGETS, digest, emptySnapshot, sourceKey } from '@/lib/learner-memory/contracts';
import {
  prepareClassroomMemory,
  applyClassroomMemory,
} from '@/lib/learner-memory/classroom-transition';
import {
  classroomMemorySources,
  type ClassroomMemorySource,
  type ProfileMemorySnapshot,
} from '@/lib/learner-memory/profile-memory-snapshot';
import type { ProfileMemorySource } from '@/lib/learner-memory/profile-memory-contracts';
import {
  eventSchema,
  questionSchema,
  safeError,
  VALIDATION_FEEDBACK_RESERVE,
  type Event,
  type Question,
  type Method,
  type Config,
} from './contracts';
import { ModelSession } from './model';
import {
  EXTRACTION_SYSTEM,
  ANSWER_SYSTEM,
  JUDGE_SYSTEM,
  extractSources,
  memoryText,
  answerSchema,
  scoreSchema,
  parseModelJSON,
  sourceContent,
} from './prompts';
import { fixtureMemory } from './fixture';
import { buildMemoryPrompt } from '@/lib/learner-memory/prompt';

export function validateInputs(rawEvents: unknown, rawQuestions: unknown) {
  const events = eventSchema.array().min(1).parse(rawEvents),
    questions = questionSchema.array().parse(rawQuestions);
  const unique = new Map<string, Event>();
  let duplicates = 0;
  for (const e of events) {
    const key = `${e.learnerId}:${e.id}`,
      before = unique.get(key);
    if (before && digest(before) !== digest(e)) throw new Error('EVENT_VERSION_CONFLICT');
    if (before) duplicates++;
    else unique.set(key, e);
  }
  const ordered = [...unique.values()].sort(
    (a, b) => a.learnerId.localeCompare(b.learnerId) || a.ordinal - b.ordinal,
  );
  const last = new Map<string, Event>();
  for (const e of ordered) {
    const prev = last.get(e.learnerId);
    if (
      prev &&
      (prev.ordinal === e.ordinal ||
        (prev.occurredAt && e.occurredAt && Date.parse(prev.occurredAt) > Date.parse(e.occurredAt)))
    )
      throw new Error('EVENT_ORDER_CONFLICT');
    last.set(e.learnerId, e);
  }
  const seenQuestions = new Set<string>();
  for (const q of questions) {
    const key = `${q.learnerId}:${q.id}`;
    if (seenQuestions.has(key) || !last.has(q.learnerId))
      throw new Error('QUESTION_ASSOCIATION_INVALID');
    seenQuestions.add(key);
    if (q.sourceIds.some((id) => !unique.has(`${q.learnerId}:${id}`)))
      throw new Error('QUESTION_SOURCE_UNKNOWN');
    if (q.checkpoint !== undefined) {
      const prefix = ordered.filter((e) => e.learnerId === q.learnerId).slice(0, q.checkpoint);
      if (
        prefix.length !== q.checkpoint ||
        q.sourceIds.some((id) => !prefix.some((e) => e.id === id))
      )
        throw new Error('QUESTION_CHECKPOINT_INVALID');
    }
  }
  return { events: ordered, questions, duplicates };
}

export function eventSources(e: Event): ClassroomMemorySource[] {
  const job = `eval:${digest([e.learnerId, e.id]).slice(0, 32)}`,
    version = digest(e);
  const hasAnswers = e.parts.every((p) => p.answer !== undefined);
  const locate = (s: ClassroomMemorySource) => {
    const body = JSON.parse(s.text);
    const questionType =
      typeof body.question === 'string'
        ? (body.question.match(/^(单选|多选|填空|简答|判断)(?:题)?[:：]/)?.[1] ??
          (body.options?.length ? '选择题' : undefined))
        : undefined;
    return {
      ...s,
      text: JSON.stringify({
        ...body,
        ordinal: e.ordinal,
        questionId: e.questionId,
        concepts: e.concepts,
        recordedTime: e.recordedTime,
        answerAvailable: body.answer !== undefined,
        questionType,
      }),
    };
  };
  if (hasAnswers) {
    const basis: ProfileMemorySource = {
      stageId: 'offline',
      title: 'offline',
      kind: e.kind,
      occurredAt: e.occurredAt ?? '1970-01-01T00:00:00.000Z',
      parts: e.parts.map((p) => ({ ...p, answer: p.answer! })),
    };
    return classroomMemorySources(job, version, null, basis).map((s) =>
      locate({
        ...s,
        occurredAt: e.occurredAt,
      }),
    );
  }
  // Public correctness logs are not native submissions. No invented learner answer.
  return e.parts
    .flatMap((p, partIndex) =>
      p.review === 'unknown'
        ? []
        : [
            {
              id: `${job}:${partIndex}`,
              version: digest([`${job}:${partIndex}`, version]),
              kind: 'quiz_evidence' as const,
              sourceNature: 'classroom' as const,
              text: JSON.stringify({
                ...p,
                help: undefined,
                answerAvailable: p.answer !== undefined,
                questionId: e.questionId,
                concepts: e.concepts,
                recordedTime: e.recordedTime,
              }),
              refs: ['quiz'],
              conditions: p.help === 'unknown' ? [] : [p.help],
              occurredAt: e.occurredAt,
              jobId: job,
              partIndex,
              reviewId: null,
              sourceDigest: version,
            },
          ],
    )
    .map(locate);
}

export type StepResult = {
  eventIds: string[];
  checkpoint: number;
  before: ProfileMemorySnapshot;
  after: ProfileMemorySnapshot;
  selectedCheckpoint?: boolean;
  status: 'updated' | 'no-sources' | 'failed';
  error?: string;
  decisions?: unknown;
  callIndices: number[];
};
export type AnswerResult = {
  id: string;
  category: Question['category'];
  answer: string | null;
  correct: boolean | null;
  reason: string;
  error?: string;
  checkpoint?: number;
};
export type ArmResult = {
  learnerId: string;
  method: Method;
  steps: StepResult[];
  snapshot: ProfileMemorySnapshot;
  complete: boolean;
  answers: AnswerResult[];
};

export function prepareExtractedBatch(
  prepared: ReturnType<typeof prepareClassroomMemory>,
  compressed: ClassroomMemorySource[],
) {
  if (
    compressed.length !== prepared.batch.length ||
    compressed.some((s, i) => sourceKey(s) !== sourceKey(prepared.batch[i]))
  )
    throw new Error('EXTRACTION_REFERENCE_INVALID');
  return {
    ...prepared,
    ...buildMemoryPrompt(
      prepared.snapshot,
      compressed,
      prepared.budgets,
      Object.entries(prepared.aliases)
        .filter(([alias]) => alias.startsWith('s'))
        .map(([, s]) => s),
      prepared.prompt.system,
      true,
    ),
    batch: compressed,
  };
}

export async function replay(
  events: Event[],
  method: Exclude<Method, 'raw-history'>,
  session: ModelSession,
  save: (step: StepResult) => void = () => {},
): Promise<Omit<ArmResult, 'answers'>> {
  let snapshot = emptySnapshot<ClassroomMemorySource>();
  const steps: StepResult[] = [],
    originals = new Map<string, ClassroomMemorySource>();
  let complete = true;
  for (let offset = 0; offset < events.length; offset += session.config.batchSize) {
    const chunk = events.slice(offset, offset + session.config.batchSize),
      before = structuredClone(snapshot),
      callStart = session.calls.length;
    const step: StepResult = {
      eventIds: chunk.map((e) => e.id),
      checkpoint: offset + chunk.length,
      selectedCheckpoint:
        session.config.checkpoints.includes(offset + chunk.length) ||
        offset + chunk.length === events.length,
      before,
      after: before,
      status: 'updated',
      callIndices: [],
      decisions: [],
    };
    try {
      const increments = chunk.flatMap(eventSources);
      const pending = [...increments];
      while (pending.length) {
        // Rehydrate only currently supported old evidence. Never expose future events.
        const keys = new Set(snapshot.pieces.flatMap((p) => p.supports.map(sourceKey)));
        const old = [...originals.values()].filter((s) => keys.has(sourceKey(s)));
        let prepared = prepareClassroomMemory(
          snapshot,
          pending,
          old,
          session.config.validationRetries > 0 ? VALIDATION_FEEDBACK_RESERVE : 0,
        );
        if (method === 'two-stage') {
          const batch = prepared.batch;
          const user = JSON.stringify({
            sources: batch.map((s, i) => ({
              source: `e${i + 1}`,
              text: sourceContent(s.text),
              conditions: s.conditions,
              occurredAt: s.occurredAt,
            })),
          });
          const compressed = await session.callValidated(
            {
              stage: 'extract',
              system: EXTRACTION_SYSTEM,
              user,
              fixtureReply: JSON.stringify({
                facts: batch.map((s, i) => ({ source: `e${i + 1}`, text: s.text })),
              }),
            },
            (reply) => extractSources(reply, batch),
          );
          // Preserve the original admission decision, including any dropped old text.
          // An oversized extracted request fails explicitly; it never changes batch or restores s text.
          prepared = prepareExtractedBatch(prepared, compressed);
        }
        const next = await session.callValidated(
          {
            stage: 'memory',
            system: prepared.prompt.system,
            user: prepared.prompt.user,
            fixtureReply: fixtureMemory(prepared),
          },
          (reply) => {
            const next = applyClassroomMemory(prepared, reply);
            if (next.decisions.some((d) => d.action === 'defer'))
              throw new Error('MEMORY_DEFERRED');
            return next;
          },
        );
        snapshot = next.snapshot;
        step.decisions = [...(step.decisions as unknown[]), ...next.decisions];
        for (const s of prepared.batch) originals.set(sourceKey(s), s);
        pending.splice(0, prepared.batch.length);
      }
      if (!increments.length) step.status = 'no-sources';
      step.after = structuredClone(snapshot);
    } catch (error) {
      step.status = 'failed';
      step.error = safeError(error);
      step.after = structuredClone(snapshot);
      complete = false;
    }
    step.callIndices = session.calls.slice(callStart).map((c) => c.index);
    steps.push(step);
    save(step);
    if (!complete) break;
  }
  return { learnerId: events[0].learnerId, method, steps, snapshot, complete };
}

export async function answerQuestions(
  arm: Omit<ArmResult, 'answers'>,
  questions: Question[],
  session: ModelSession,
  context: unknown = memoryText(arm.snapshot),
): Promise<AnswerResult[]> {
  const answers: AnswerResult[] = [];
  // Save all answers before any gold enters a judge call.
  for (const q of questions) {
    session.context = { ...session.context, questionId: q.id };
    const row: AnswerResult = {
      id: q.id,
      category: q.category,
      answer: null,
      correct: null,
      reason: 'Not scored',
      checkpoint: q.checkpoint,
    };
    answers.push(row);
    const checkpointStep =
      q.checkpoint === undefined
        ? undefined
        : arm.steps.find((s) => s.checkpoint === q.checkpoint && s.status !== 'failed');
    const available =
      q.checkpoint === undefined ? arm.complete : arm.method === 'raw-history' || !!checkpointStep;
    if (!available) {
      row.error = 'INCOMPLETE_REPLAY';
      continue;
    }
    try {
      const learningContext =
        typeof context === 'function'
          ? context(q)
          : checkpointStep
            ? memoryText(checkpointStep.after)
            : context;
      const user = JSON.stringify({ learningContext, question: q.question });
      if (Buffer.byteLength(ANSWER_SYSTEM + user, 'utf8') > session.config.maxAnswerInputBytes)
        throw new Error('ANSWER_INPUT_CAPACITY_EXCEEDED');
      row.answer = (
        await session.callValidated(
          {
            stage: 'answer',
            system: ANSWER_SYSTEM,
            user,
            fixtureReply: '{"answer":"unknown"}',
          },
          (reply) => answerSchema.parse(parseModelJSON(reply)),
        )
      ).answer;
    } catch (error) {
      row.error = safeError(error);
    }
  }
  for (const [i, q] of questions.entries()) {
    session.context = { ...session.context, questionId: q.id };
    const row = answers[i];
    if (row.answer === null) continue;
    try {
      const result = await session.callValidated(
        {
          stage: 'judge',
          system: JUDGE_SYSTEM,
          user: JSON.stringify({ question: q.question, answer: row.answer, reference: q.gold }),
          fixtureReply: JSON.stringify({
            correct: row.answer.trim() === q.gold.trim(),
            reason: 'Fixture exact equality only; not a semantic judgment',
          }),
        },
        (reply) => scoreSchema.parse(parseModelJSON(reply)),
      );
      row.correct = result.correct;
      row.reason = result.reason;
      if (result.correct === null) row.error = 'SCORING_UNDETERMINED';
    } catch (error) {
      row.error = safeError(error);
    }
  }
  return answers;
}

export function hasIncompleteResults(results: ArmResult[]) {
  return results.some((r) => !r.complete || r.answers.some((a) => a.error || a.correct === null));
}

/** Same admitted source projection as the memory arms, with no summarization or truncation. */
export function rawHistoryContext(history: Event[]) {
  return history.flatMap(eventSources).map((s) => ({
    kind: s.kind,
    content: sourceContent(s.text),
    conditions: s.conditions,
    occurredAt: s.occurredAt,
  }));
}

export async function runExperiment(
  events: Event[],
  questions: Question[],
  config: Config,
  session: ModelSession,
  save: (learnerId: string, method: Method, step: StepResult) => void = () => {},
) {
  if (
    config.mode === 'live' &&
    events.some((e) => e.origin === 'public') &&
    !config.allowPublicExternal
  )
    throw new Error('PUBLIC_EXTERNAL_PROCESSING_NOT_AUTHORIZED');
  const results: ArmResult[] = [];
  for (const learner of new Set(events.map((e) => e.learnerId))) {
    const history = events.filter((e) => e.learnerId === learner),
      qs = questions.filter((q) => q.learnerId === learner);
    for (const method of config.methods) {
      session.context = { learnerId: learner, method };
      if (method === 'raw-history') {
        const arm = {
          learnerId: learner,
          method,
          steps: [],
          snapshot: emptySnapshot<ClassroomMemorySource>(),
          complete: true,
        };
        results.push({
          ...arm,
          answers: await answerQuestions(arm, qs, session, (q: Question) =>
            rawHistoryContext(history.slice(0, q.checkpoint ?? history.length)),
          ),
        });
      } else {
        const arm = await replay(history, method, session, (step) => save(learner, method, step));
        results.push({ ...arm, answers: await answerQuestions(arm, qs, session) });
      }
    }
  }
  return { config, budgets: DEFAULT_BUDGETS, results };
}
