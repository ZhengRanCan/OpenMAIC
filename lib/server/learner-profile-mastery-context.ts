import type { Queryable } from '@openmaic/storage/document/pg';
import { z } from 'zod';
import { digest } from '@/lib/learner-memory/contracts';
import { assertLearnerProfileIn, LearnerProfileError } from '@/lib/persistence/learner-profiles';
import type { Action } from '@/lib/types/action';
import { generationRunPersistence } from './generation/run/store';
import { readProfileMemoryCandidates } from './generation/run/interactive-profile-memory';
import { profileOutlineRecordForUse } from '@/lib/learner-context/profile-outline-memory';
import { readProfilePlannerMastery } from './learner-profile-mastery';
import { invokeMemorySelectionModel } from './learner-memory-selection-model';

export type ProfileSceneScope = {
  runId: string;
  profileId: string;
  title: string;
  actions: Action[] | null;
};

export async function readProfileSceneScopeIn(
  tx: Queryable,
  owner: string,
  stageId: string,
  sceneId: string,
): Promise<ProfileSceneScope | undefined> {
  const {
    rows: [scope],
  } = await tx.query<ProfileSceneScope>(
    `SELECT r.id AS "runId", p.id AS "profileId", d.data->>'title' AS title,
            d.data->'actions' AS actions
       FROM classroom_learner_profiles b
       JOIN learner_profiles p ON p.id=b.profile_id
       JOIN stage_meta s ON s.stage_id=b.stage_id AND s.owner_id=$1 AND s.deleted_at IS NULL
       JOIN document_stages ds ON ds.id=s.stage_id AND ds.task_engine_mode IS NOT TRUE
       JOIN generation_runs r ON r.id=b.run_id AND r.stage_id=b.stage_id AND r.owner_id=$1
         AND r.state='completed' AND COALESCE(r.outline->>'taskEngineMode','false')='false'
       JOIN document_scenes d ON d.stage_id=b.stage_id AND d.id=$3
       WHERE b.stage_id=$2`,
    [owner, stageId, sceneId],
  );
  if (!scope) return;
  try {
    await assertLearnerProfileIn(tx, owner, scope.profileId);
    return scope;
  } catch (error) {
    if (!(error instanceof LearnerProfileError)) throw error;
  }
}

export async function resolveProfileSceneScope(owner: string, stageId: string, sceneId: string) {
  const { withTransaction } = await generationRunPersistence();
  return withTransaction(async (tx) => {
    await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
    return readProfileSceneScopeIn(tx, owner, stageId, sceneId);
  });
}

const replySchema = z.strictObject({ selected: z.array(z.string().max(6)).max(3) });
const versionHash = z.string().regex(/^[a-f0-9]{64}$/);
const locatorSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('memory'),
    key: z.string().min(1).max(160),
    checksum: versionHash,
  }),
  z.strictObject({
    kind: z.literal('mastery'),
    stageId: z.string().min(1).max(160),
    targetId: z.string().min(1).max(160),
    revision: z.number().int().positive(),
    checksum: versionHash,
  }),
]);

type MasteryCandidate = Awaited<ReturnType<typeof readProfilePlannerMastery>>[number];

function masteryChecksum({ target, sourceVersion, sourceStageId, ...data }: MasteryCandidate) {
  return digest([target, sourceVersion, sourceStageId, data]);
}

async function candidates(owner: string, profileId: string) {
  const [memory, mastery] = await Promise.all([
    readProfileMemoryCandidates(owner, profileId),
    readProfilePlannerMastery(owner, profileId),
  ]);
  return [
    ...memory.flatMap(({ key, ...record }, index) => {
      const value = profileOutlineRecordForUse(record);
      if (!value.text) return [];
      return [
        {
          id: `M${index + 1}`,
          kind: 'memory' as const,
          value,
          fingerprint: JSON.stringify({
            kind: 'memory',
            key,
            checksum: digest({ key, ...record }),
          }),
        },
      ];
    }),
    ...mastery.map((item, index) => {
      const { target, sourceVersion: _version, sourceStageId, ...data } = item;
      return {
        id: `T${index + 1}`,
        kind: 'mastery' as const,
        value: { target: target.statement, ...data },
        fingerprint: JSON.stringify({
          kind: 'mastery',
          stageId: sourceStageId,
          targetId: target.id,
          revision: target.revision,
          checksum: masteryChecksum(item),
        }),
      };
    }),
  ];
}

export async function checkProfileActivityHistory(
  owner: string,
  profileId: string,
  fingerprints: string[],
) {
  for (const fingerprint of fingerprints) {
    const parsed = locatorSchema.safeParse(JSON.parse(fingerprint));
    if (!parsed.success) return false;
    const ref = parsed.data;
    if (ref.kind === 'memory') {
      const [current] = await readProfileMemoryCandidates(owner, profileId, [ref.key]);
      if (!current || digest(current) !== ref.checksum) return false;
    } else {
      const [current] = await readProfilePlannerMastery(owner, profileId, ref);
      if (!current || masteryChecksum(current) !== ref.checksum) return false;
    }
  }
  return true;
}

type Input = Omit<Parameters<typeof invokeMemorySelectionModel>[0], 'prompt'> & {
  owner: string;
  profileId: string;
  task: unknown;
  system: string;
};

export async function selectProfileActivityHistory(
  input: Input,
  invoke = invokeMemorySelectionModel,
) {
  const { owner, profileId, system, task, signal } = input;
  const available = await candidates(owner, profileId);
  const bounded = (kind: 'memory' | 'mastery', limit: number) =>
    available
      .filter((item) => item.kind === kind && Buffer.byteLength(JSON.stringify(item.value)) <= 2500)
      .slice(0, limit)
      .map(({ id, value }) => ({ id, kind, value }));
  const projected = [...bounded('memory', 8), ...bounded('mastery', 4)];
  const user = JSON.stringify({ task, candidates: projected });
  if (!projected.length || Buffer.byteLength(user) > 48_000) return;
  const raw = await invoke({
    ...input,
    prompt: { system, user, inputBytes: Buffer.byteLength(system + user) },
  });
  if (Buffer.byteLength(raw) > 2048) throw new Error('PROFILE_HISTORY_RESPONSE_LIMIT');
  const { selected } = replySchema.parse(JSON.parse(raw));
  const visible = new Set(projected.map(({ id }) => id));
  if (
    new Set(selected).size !== selected.length ||
    selected.some((id) => !visible.has(id)) ||
    selected.filter((id) => id.startsWith('T')).length > 1 ||
    selected.filter((id) => id.startsWith('M')).length > 2
  )
    throw new Error('PROFILE_HISTORY_SELECTION_INVALID');
  const chosen = available.filter(({ id }) => selected.includes(id));
  if (!chosen.length) return;
  const fingerprints = chosen.map(({ fingerprint }) => fingerprint);
  signal?.throwIfAborted();
  if (!(await checkProfileActivityHistory(owner, profileId, fingerprints)))
    throw new Error('PROFILE_HISTORY_CHANGED');
  return {
    fingerprints,
    text: JSON.stringify(chosen.map(({ kind, value }) => ({ kind, ...value }))),
  };
}
