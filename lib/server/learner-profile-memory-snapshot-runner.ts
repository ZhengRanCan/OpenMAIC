import { DEFAULT_BUDGETS, MemoryError, SECTIONS, sourceKey } from '@/lib/learner-memory/contracts';
import { omitUnknownHelpFromExperience } from '@/lib/learner-memory/profile-memory-content';
import {
  CLASSROOM_MEMORY_SYSTEM,
  classroomMemorySources,
} from '@/lib/learner-memory/profile-memory-snapshot';
import { buildMemoryPrompt } from '@/lib/learner-memory/prompt';
import { validateTransition } from '@/lib/learner-memory/transition';
import {
  profileMemorySourceVersion,
  readProfileMemorySource,
  readProfileSourceAccess,
  type ProfileSourceLocator,
} from '@/lib/persistence/learner-profile-memory-source';
import {
  inspectProfileSnapshotIn,
  readProfileSnapshotIn,
  readSnapshotRestrictionsIn,
} from '@/lib/persistence/learner-profile-memory-snapshot';
import { forwardOwnerWrite } from '@/lib/persistence/owner-merges';
import type { ServerPersistenceProvider } from '@/lib/persistence/server-provider';

type Provider = Pick<ServerPersistenceProvider, 'pool' | 'withTransaction'>;
type Invoke = (owner: string, system: string, prompt: string) => Promise<string>;
type Source = NonNullable<ReturnType<typeof profileMemorySourceVersion>> & { owner: string };
type Checkpoint = { digest: string; reply?: string };
export type ProfileMemoryJob = ProfileSourceLocator & {
  id: string;
  claim_id: string;
  attempts: number;
  requested_review_ordinal: number | null;
  snapshot_done_refs: number[];
  snapshot_deferred_refs: number[];
  snapshot_call: Checkpoint | null;
};
export class ProfileMemoryKnownModelFailure extends Error {}

/** Dispatched calls with an unknown outcome can be explicitly retried from the classroom import UI. */
export async function processSnapshotMemory(
  app: Provider,
  job: ProfileMemoryJob,
  source: Source,
  invoke: Invoke,
): Promise<boolean> {
  const frozen = await app.withTransaction(async (tx) => {
    await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
    const profile = await readProfileSnapshotIn(tx, job.profile_id);
    if (!profile?.memory_snapshot) return null;
    const inspected = await inspectProfileSnapshotIn(
      tx,
      source.owner,
      job.profile_id,
      profile.memory_snapshot,
    );
    const batch = classroomMemorySources(job.id, source.digest, source.reviewId, source.basis);
    const blocked = await readSnapshotRestrictionsIn(
      tx,
      job.profile_id,
      batch.map(({ id }) => id),
    );
    const eligible = batch.filter(
      ({ id, partIndex }) => !blocked.has(id) && !job.snapshot_done_refs.includes(partIndex),
    );
    return { ...inspected, eligible, fieldsRevision: profile.memory_revision };
  });
  if (!frozen) return false;

  const finish = (state: 'failed' | 'finished' | 'queued', clear = false) =>
    app.pool.query(
      `UPDATE learner_profile_memory_jobs SET state=$3,claim_id=NULL,claimed_at=NULL,
       ready_at=now() + interval '1 minute' * attempts,
       snapshot_call=CASE WHEN $4::boolean THEN NULL ELSE snapshot_call END
       WHERE id=$1 AND claim_id=$2`,
      [job.id, job.claim_id, state, clear],
    );
  const remaining = frozen.eligible.filter(
    ({ partIndex }) => !job.snapshot_deferred_refs.includes(partIndex),
  );
  if (!remaining.length) {
    await finish(frozen.eligible.length ? 'failed' : 'finished', true);
    return true;
  }
  const batch = remaining.slice(0, DEFAULT_BUDGETS.batchSize);
  let available = frozen.available.map((support) => ({
    ...support,
    text: support.text.slice(0, 512),
  }));
  let prepared;
  while (!prepared) {
    try {
      prepared = buildMemoryPrompt(
        frozen.snapshot,
        batch,
        DEFAULT_BUDGETS,
        available,
        CLASSROOM_MEMORY_SYSTEM,
        true,
      );
    } catch (error) {
      if (!(error instanceof MemoryError) || error.code !== 'REQUEST_CAPACITY_EXCEEDED')
        throw error;
      if (available.some(({ text }) => text)) {
        available = available.map((support) => ({ ...support, text: '' }));
      } else if (batch.length === 1) {
        await finish('failed', true);
        return true;
      } else {
        batch.pop();
      }
    }
  }
  const checkpoint = job.snapshot_call;
  if (checkpoint && checkpoint.reply === undefined) {
    await finish('failed');
    return true;
  }
  const checkpointKey = prepared.prompt.digest;
  let reply = checkpoint?.digest === checkpointKey ? checkpoint.reply : undefined;
  if (reply === undefined) {
    const dispatch = await app.withTransaction(async (tx) => {
      const owner = await forwardOwnerWrite(tx, source.owner);
      const access = await readProfileSourceAccess(tx, job, true);
      if (access?.owner_id !== owner || owner !== source.owner)
        throw new Error('PROFILE_MEMORY_SOURCE_MOVED');
      const current = profileMemorySourceVersion(
        await readProfileMemorySource(tx, { ...job, review_id: null }, access),
        source.digest,
      );
      if (!current) throw new Error('PROFILE_MEMORY_SOURCE_CHANGED');
      const saved = await tx.query(
        'UPDATE learner_profile_memory_jobs SET snapshot_call=$3 WHERE id=$1 AND claim_id=$2 RETURNING id',
        [job.id, job.claim_id, { digest: checkpointKey }],
      );
      return saved.rows.length > 0;
    });
    if (!dispatch) return true;
    try {
      reply = await invoke(source.owner, prepared.prompt.system, prepared.prompt.user);
    } catch (error) {
      if (error instanceof ProfileMemoryKnownModelFailure)
        await finish(job.attempts >= 3 ? 'failed' : 'queued', true);
      else await finish('failed');
      return true;
    }
    if (Buffer.byteLength(reply, 'utf8') > 64_000) {
      await finish('failed', true);
      return true;
    }
    const captured = await app.pool.query(
      'UPDATE learner_profile_memory_jobs SET snapshot_call=$3 WHERE id=$1 AND claim_id=$2 RETURNING id',
      [job.id, job.claim_id, { digest: checkpointKey, reply }],
    );
    if (!captured.rows.length) return true;
  }

  const supportsBefore = new Set(frozen.available.map(sourceKey));
  let transition;
  try {
    transition = validateTransition(
      { ...prepared, snapshot: frozen.snapshot, budgets: DEFAULT_BUDGETS },
      JSON.parse(reply),
    );
    const snapshot = transition.snapshot;
    const supports = snapshot.pieces.flatMap((piece) => piece.supports.map(sourceKey));
    if (new Set(supports).size > 64 || supports.length > 96)
      throw new Error('PROFILE_MEMORY_SUPPORT_CAPACITY');
    for (const piece of snapshot.pieces) {
      const hasQuiz = piece.supports.some(({ kind }) => kind === 'quiz_evidence');
      const hasQa = piece.supports.some(({ refs }) => refs[0] === 'qa');
      if (
        SECTIONS.some(
          (section) =>
            snapshot.sections[section].includes(piece.id) &&
            ((hasQuiz && section !== 'learning_experiences') ||
              (hasQa && section !== 'goals' && section !== 'teaching_requirements')),
        )
      )
        throw new Error('PROFILE_MEMORY_SOURCE_SECTION');
      piece.text = omitUnknownHelpFromExperience(piece.text);
      if (!piece.text) throw new Error('PROFILE_MEMORY_EMPTY_PIECE');
      // Authoritative trace supplies the source text again when needed.
      piece.supports = piece.supports.map((support) => ({ ...support, text: '' }));
    }
  } catch {
    await finish(job.attempts >= 3 ? 'failed' : 'queued', true);
    return true;
  }
  const decisions = transition.decisions.map((decision) => {
    const support = prepared.aliases[decision.source];
    return {
      ...decision,
      source: support.id,
      version: support.version,
      partIndex: support.partIndex,
    };
  });
  const done = [
    ...job.snapshot_done_refs,
    ...decisions.filter((entry) => entry.action !== 'defer').map(({ partIndex }) => partIndex),
  ];
  const deferred = [
    ...job.snapshot_deferred_refs,
    ...decisions.filter((entry) => entry.action === 'defer').map(({ partIndex }) => partIndex),
  ];
  const state =
    remaining.length > batch.length ? 'queued' : deferred.length ? 'failed' : 'finished';
  await app.withTransaction(async (tx) => {
    const owner = await forwardOwnerWrite(tx, source.owner);
    const access = await readProfileSourceAccess(tx, job, true);
    if (access?.owner_id !== owner) throw new Error('PROFILE_MEMORY_SOURCE_MOVED');
    const current = profileMemorySourceVersion(
      await readProfileMemorySource(tx, { ...job, review_id: null }, access),
      source.digest,
    );
    if (!current) throw new Error('PROFILE_MEMORY_SOURCE_CHANGED');
    const profile = await readProfileSnapshotIn(tx, job.profile_id, true);
    if (
      profile?.memory_snapshot?.revision !== frozen.snapshot.revision ||
      profile.memory_revision !== frozen.fieldsRevision
    )
      throw new Error('PROFILE_MEMORY_REVISION_CONFLICT');
    const rechecked = await inspectProfileSnapshotIn(
      tx,
      owner,
      job.profile_id,
      profile.memory_snapshot,
    );
    const supportsAfter = new Set(rechecked.available.map(sourceKey));
    if (
      supportsBefore.size !== supportsAfter.size ||
      [...supportsBefore].some((key) => !supportsAfter.has(key))
    )
      throw new Error('PROFILE_MEMORY_SUPPORT_CHANGED');
    const blocked = await readSnapshotRestrictionsIn(
      tx,
      job.profile_id,
      batch.map(({ id }) => id),
    );
    if (blocked.size) throw new Error('PROFILE_MEMORY_SOURCE_FLAGGED');
    const saved = await tx.query(
      `UPDATE learner_profile_memory_jobs SET state=$3,source_digest=$4,review_id=$5,
       claim_id=NULL,claimed_at=NULL,attempts=0,ready_at=now(),snapshot_call=NULL,
       snapshot_done_refs=$6,snapshot_deferred_refs=$7 WHERE id=$1 AND claim_id=$2 RETURNING id`,
      [job.id, job.claim_id, state, source.digest, source.reviewId, done, deferred],
    );
    if (!saved.rows.length) return;
    await tx.query('UPDATE learner_profiles SET memory_snapshot=$2 WHERE id=$1', [
      job.profile_id,
      transition.snapshot,
    ]);
    await tx.query(
      `INSERT INTO learner_profile_memory_transitions(profile_id,revision,job_id,decisions,retired)
       VALUES($1,$2,$3,$4::jsonb,$5::jsonb)`,
      [
        job.profile_id,
        transition.snapshot.revision,
        job.id,
        JSON.stringify(decisions),
        JSON.stringify(transition.resolvedRetired),
      ],
    );
  });
  return true;
}
