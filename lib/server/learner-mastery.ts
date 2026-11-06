import { randomUUID } from 'node:crypto';
import type { Queryable } from '@openmaic/storage/document/pg';
import { buildDialogueEvidenceContext } from '@/lib/dialogue/evidence-context';
import type { DialogueEvidenceSettings } from '@/lib/dialogue/evidence-contracts';
import { shortFactSources } from '@/lib/evidence/short-facts';
import { digest } from '@/lib/learner-memory/contracts';
import {
  MASTERY_QUIZ_RULES,
  MASTERY_SYSTEM,
  synthesizeMastery,
  type MasteryEvidence,
  type MasteryState,
} from '@/lib/learner-mastery/synthesis';
import {
  dialogueEvidenceRunIn,
  dialogueSourceStatusIn,
} from '@/lib/persistence/dialogue-evidence-read';
import { fenceOwnerWrite } from '@/lib/persistence/owner-merges';
import { readPreparedIn } from '@/lib/persistence/quiz-trace';
import type { ServerPersistenceProvider } from '@/lib/persistence/server-provider';
import { resolveDialogueBindingIn, verifyDialogueBindingIn } from './dialogue-evidence-provenance';
import type { CourseTarget } from './generation/run/types';
import { QuizShortFactsService } from './quiz-short-facts';

export interface MasteryLocator {
  ownerId: string;
  runId: string;
  targetId: string;
  targetRevision: number;
}
interface CourseScope {
  stageId: string;
  student: 'A' | 'B' | 'C';
  target: CourseTarget;
}
interface SourceRef {
  kind?: 'quiz';
  runId: string;
  evidenceRef: string;
  key: string;
}
export type MasterySource = string | { kind: 'quiz'; runId: string };
type SourceEntry = { ref: SourceRef; evidence: MasteryEvidence };

function distinctSources(sources: readonly MasterySource[]) {
  return new Map(
    sources.map((source) => [
      typeof source === 'string' ? `dialogue:${source}` : `quiz:${source.runId}`,
      source,
    ]),
  ).values();
}
interface Pending {
  token: string;
  sources: SourceRef[];
  captured?: { state: MasteryState | null };
}
interface Row {
  state: MasteryState | null;
  sources: SourceRef[];
  pending?: Pending;
}

async function readCourse(
  tx: Queryable,
  locator: MasteryLocator,
  lock: boolean,
): Promise<CourseScope> {
  const result = await tx.query<{ stage_id: string; student: string; targets: unknown }>(
    `SELECT r.stage_id, r.input->>'simulatedLearner' AS student, r.outline->'targets' AS targets
       FROM generation_runs r JOIN stage_meta s ON s.stage_id=r.stage_id AND s.owner_id=r.owner_id
      WHERE r.id=$1 AND r.owner_id=$2 AND r.state='completed' AND s.deleted_at IS NULL
      ${lock ? 'FOR UPDATE OF s' : ''}`,
    [locator.runId, locator.ownerId],
  );
  const row = result.rows[0];
  if (!row || (row.student !== 'A' && row.student !== 'B' && row.student !== 'C'))
    throw new Error('MASTERY_COURSE_UNAVAILABLE');
  const target =
    Array.isArray(row.targets) &&
    row.targets.find(
      (value) => value?.id === locator.targetId && value.revision === locator.targetRevision,
    );
  if (!target || typeof target.statement !== 'string' || !target.statement.trim())
    throw new Error('MASTERY_TARGET_UNAVAILABLE');
  return {
    stageId: row.stage_id,
    student: row.student,
    target: { id: target.id, revision: target.revision, statement: target.statement },
  };
}

async function readSources(
  tx: Queryable,
  locator: MasteryLocator,
  course: CourseScope,
  settings: DialogueEvidenceSettings,
  sources: Iterable<MasterySource>,
) {
  const entries: SourceEntry[] = [];
  for (const source of sources) {
    if (typeof source !== 'string') {
      entries.push(...(await readQuizSources(tx, locator, course, settings, source.runId)));
      continue;
    }
    const runId = source;
    const run = await dialogueEvidenceRunIn(tx, locator.ownerId, runId);
    const { snapshot, binding } = run;
    if (
      run.stageId !== course.stageId ||
      !snapshot ||
      !binding ||
      (run.state !== 'completed' && run.state !== 'empty') ||
      binding.student !== course.student ||
      binding.generationRunId !== locator.runId ||
      binding.memoryEnvironmentId !== settings.memoryEnvironmentId ||
      binding.sourceNature !== 'synthetic'
    )
      throw new Error('MASTERY_SOURCE_UNAVAILABLE');
    const current = await resolveDialogueBindingIn(tx, snapshot, settings);
    if (
      !current ||
      digest(current) !== digest(binding) ||
      !(await verifyDialogueBindingIn(tx, snapshot, current))
    )
      throw new Error('MASTERY_SOURCE_UNAVAILABLE');
    const live = await dialogueSourceStatusIn(tx, locator.ownerId, run);
    if (
      live.status !== 'available' ||
      live.source.generation !== snapshot.generation ||
      live.source.runtimeSessionId !== snapshot.runtimeSessionId
    )
      throw new Error('MASTERY_SOURCE_UNAVAILABLE');
    const context = buildDialogueEvidenceContext(live.source);
    for (const fact of run.facts) {
      if (
        !fact.refs.every(
          (id) =>
            context.messageVersions[id] && context.messageVersions[id] === fact.messageVersions[id],
        )
      )
        throw new Error('MASTERY_SOURCE_CHANGED');
      const evidenceRef = `${run.id}/${fact.id}`;
      entries.push({
        ref: {
          runId,
          evidenceRef,
          key: digest([run.chatSessionId, snapshot.generation, fact.fingerprint]),
        },
        evidence: {
          evidenceRef,
          type: fact.type,
          text: fact.evidence,
          conditions: current.conditions,
          messages: snapshot.messages
            .filter(({ message }) => fact.refs.includes(message.id))
            .map(({ message, text }) => ({ role: context.sourceIndex[message.id]!.role, text })),
        },
      });
    }
  }
  return entries;
}

async function readQuizSources(
  tx: Queryable,
  locator: MasteryLocator,
  course: CourseScope,
  settings: DialogueEvidenceSettings,
  runId: string,
): Promise<SourceEntry[]> {
  const run = await new QuizShortFactsService((body) => body(tx)).readVerifiedIn(
    tx,
    locator.ownerId,
    runId,
  );
  if (
    run.state !== 'completed' ||
    !run.snapshot ||
    !run.reply ||
    run.context.source.stageId !== course.stageId ||
    run.request.generationRunId !== locator.runId ||
    run.request.student !== course.student ||
    run.request.sourceNature !== 'synthetic' ||
    run.request.memoryEnvironmentId !== settings.memoryEnvironmentId
  )
    throw new Error('MASTERY_SOURCE_UNAVAILABLE');
  const quiz = await readPreparedIn(tx, locator.ownerId, run.request.attemptId);
  const { scene } = quiz.version;
  if (scene.type !== 'quiz' || !quiz.submission) throw new Error('MASTERY_SOURCE_UNAVAILABLE');
  const { answers } = quiz.submission;
  const questions = new Map(
    scene.content.questions.map((question) => [`${quiz.version.id}:${question.id}`, question]),
  );
  const { validation } = shortFactSources({
    student: run.request.student,
    runId: run.id,
    snapshotFile: `postgres:f68_short_facts_runs/${run.id}/snapshot`,
    snapshotBytes: Buffer.from(run.snapshot),
    reply: run.reply.text,
    refs: run.context.refs,
    sourceNature: run.request.sourceNature,
    occurredAt: run.context.source.savedAt,
  });
  if (validation.status === 'invalid') throw new Error('MASTERY_SOURCE_UNAVAILABLE');
  return validation.accepted.map(({ sourceIndex, fact }) => {
    const evidenceRef = `quiz:${run.id}/${sourceIndex}`;
    const refs = fact.refs.map((ref) => run.context.refs[ref]!);
    return {
      ref: {
        kind: 'quiz',
        runId,
        evidenceRef,
        key: digest(['quiz', fact.type, fact.evidence, refs.map((ref) => ref.traceRef).sort()]),
      },
      evidence: {
        evidenceRef,
        type: 'quiz_performance',
        text: fact.evidence,
        conditions: run.request.conditions,
        questions: refs.map((ref) => {
          const question = questions.get(ref.questionIdentity);
          if (!question) throw new Error('MASTERY_SOURCE_CHANGED');
          return {
            type: question.type,
            prompt: question.question,
            options: question.options,
            submitted: answers[question.id] ?? null,
            answerKey: question.answer,
          };
        }),
      },
    };
  });
}

export class LearnerMastery {
  constructor(
    private readonly provider: Pick<ServerPersistenceProvider, 'withTransaction'>,
    private readonly settings: DialogueEvidenceSettings,
  ) {
    if (!settings.memoryEnvironmentId) throw new Error('MASTERY_ENVIRONMENT_REQUIRED');
  }

  private key(locator: MasteryLocator) {
    return [
      locator.runId,
      this.settings.memoryEnvironmentId,
      locator.targetId,
      locator.targetRevision,
    ];
  }

  private async readRow(tx: Queryable, locator: MasteryLocator): Promise<Row> {
    const r = await tx.query<{ data: Row }>(
      `SELECT data FROM generation_target_mastery
        WHERE run_id=$1 AND environment_id=$2 AND target_id=$3 AND target_revision=$4`,
      this.key(locator),
    );
    return r.rows[0]?.data ?? { state: null, sources: [] };
  }

  private async writeRow(tx: Queryable, locator: MasteryLocator, row: Row) {
    await tx.query(
      `INSERT INTO generation_target_mastery(run_id,environment_id,target_id,target_revision,data)
       VALUES($1,$2,$3,$4,$5::jsonb)
       ON CONFLICT(run_id,environment_id,target_id,target_revision) DO UPDATE SET data=excluded.data`,
      [...this.key(locator), JSON.stringify(row)],
    );
  }

  private async verifyRefs(
    tx: Queryable,
    locator: MasteryLocator,
    course: CourseScope,
    refs: SourceRef[],
  ) {
    const available = await readSources(
      tx,
      locator,
      course,
      this.settings,
      distinctSources(
        refs.map((ref) => (ref.kind === 'quiz' ? { kind: 'quiz', runId: ref.runId } : ref.runId)),
      ),
    );
    const keys = new Map(available.map(({ ref }) => [ref.evidenceRef, ref.key]));
    if (refs.some((ref) => keys.get(ref.evidenceRef) !== ref.key))
      throw new Error('MASTERY_SOURCE_CHANGED');
  }

  private adopted(row: Row): SourceRef[] {
    const refs = new Set(row.state?.state.observations.map(({ evidenceRef }) => evidenceRef));
    return row.sources.filter(({ evidenceRef }) => refs.has(evidenceRef));
  }

  async read(locator: MasteryLocator): Promise<MasteryState | null> {
    return this.provider.withTransaction(async (tx) => {
      await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
      const course = await readCourse(tx, locator, false);
      const row = await this.readRow(tx, locator);
      await this.verifyRefs(tx, locator, course, this.adopted(row));
      return row.state;
    });
  }

  async maintain(
    locator: MasteryLocator,
    sources: readonly MasterySource[],
    generate: (system: string, user: string) => Promise<string>,
  ): Promise<MasteryState | null> {
    const sourceList = [...distinctSources(sources)];
    if (sourceList.length > 12) throw new Error('MASTERY_INPUT_LIMIT');
    const prepared = await this.provider.withTransaction(async (tx) => {
      await fenceOwnerWrite(tx, locator.ownerId);
      const course = await readCourse(tx, locator, true);
      let row = await this.readRow(tx, locator);
      await this.verifyRefs(tx, locator, course, this.adopted(row));
      if (row.pending) {
        if (!row.pending.captured) throw new Error('MASTERY_INVOCATION_PENDING_OR_UNKNOWN');
        row = await this.commitCaptured(tx, locator, course, row, row.pending);
      }
      const entries = await readSources(tx, locator, course, this.settings, sourceList);
      const seen = new Set(row.sources.map(({ key }) => key));
      const next = entries.filter(({ ref }) => {
        if (seen.has(ref.key)) return false;
        seen.add(ref.key);
        return true;
      });
      if (!next.length) return { state: row.state };
      const evidence = next.map((entry) => entry.evidence);
      const user = JSON.stringify({
        target: course.target,
        previous: row.state?.state ?? null,
        evidence,
      });
      if (evidence.length > 24 || Buffer.byteLength(user) > 64 * 1024)
        throw new Error('MASTERY_INPUT_LIMIT');
      const token = randomUUID();
      await this.writeRow(tx, locator, {
        ...row,
        pending: { token, sources: next.map((entry) => entry.ref) },
      });
      return { course, evidence, previous: row.state, token, user };
    });
    if (!prepared.token) return prepared.state;

    const system = prepared.evidence.some(({ type }) => type === 'quiz_performance')
      ? `${MASTERY_SYSTEM}\n${MASTERY_QUIZ_RULES}`
      : MASTERY_SYSTEM;
    const raw = await generate(system, prepared.user);
    let state: MasteryState | null;
    try {
      state = synthesizeMastery(
        raw,
        prepared.course.target,
        `simulated-${prepared.course.student}`,
        prepared.previous,
        prepared.evidence,
      );
    } catch (error) {
      await this.recordReply(locator, prepared.token);
      throw error;
    }
    await this.recordReply(locator, prepared.token, { state });
    return this.finish(locator, prepared.token);
  }

  private async recordReply(
    locator: MasteryLocator,
    token: string,
    captured?: { state: MasteryState | null },
  ) {
    await this.provider.withTransaction(async (tx) => {
      await fenceOwnerWrite(tx, locator.ownerId);
      await readCourse(tx, locator, true);
      const row = await this.readRow(tx, locator);
      if (row.pending?.token !== token) throw new Error('MASTERY_INVOCATION_CHANGED');
      await this.writeRow(tx, locator, {
        state: row.state,
        sources: row.sources,
        ...(captured ? { pending: { ...row.pending, captured } } : {}),
      });
    });
  }

  private async finish(locator: MasteryLocator, token: string): Promise<MasteryState | null> {
    return this.provider.withTransaction(async (tx) => {
      await fenceOwnerWrite(tx, locator.ownerId);
      const course = await readCourse(tx, locator, true);
      const row = await this.readRow(tx, locator);
      await this.verifyRefs(tx, locator, course, this.adopted(row));
      // A concurrent trigger can already have finalized this captured candidate.
      if (row.pending?.token !== token) return row.state;
      return (await this.commitCaptured(tx, locator, course, row, row.pending)).state;
    });
  }

  private async commitCaptured(
    tx: Queryable,
    locator: MasteryLocator,
    course: CourseScope,
    row: Row,
    pending: Pending,
  ): Promise<Row> {
    if (!pending.captured) throw new Error('MASTERY_INVOCATION_CHANGED');
    await this.verifyRefs(tx, locator, course, pending.sources);
    const updated = {
      state: pending.captured.state,
      sources: [...row.sources, ...pending.sources],
    };
    await this.writeRow(tx, locator, updated);
    return updated;
  }
}
