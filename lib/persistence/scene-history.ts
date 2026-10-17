import { createHash, randomUUID } from 'node:crypto';
import { enumerateAssetManifest } from '@openmaic/dsl';
import type { Queryable } from '@openmaic/storage/document/pg';
import type { Scene } from '@/lib/types/stage';
import type { SceneHistoryVersion } from '@/lib/quiz/trace-types';
import { canonical, QuizTraceError } from '@/lib/quiz/trace-validation';
import { validateAppScene } from '@/lib/document-store/validators';
import { slideMediaReferenceSlots } from '@/lib/media/slide-media-slots';
import { assetPrincipalForOwner, assetReferencePrincipalsForOwner } from './owner-assets';
import type { ServerPersistenceProvider } from './server-provider';

export const digestOf = (v: unknown) => createHash('sha256').update(canonical(v)).digest('hex');
export async function ensureSceneVersionIn(
  tx: Queryable,
  provider: ServerPersistenceProvider,
  ownerId: string,
  scene: Scene,
  planning?: Record<string, unknown>,
): Promise<SceneHistoryVersion> {
  if (!validateAppScene(scene).valid || scene.type !== 'quiz')
    throw new QuizTraceError('INVALID_QUIZ_SCENE', 400);
  const questions = scene.content.questions;
  if (
    !questions.length ||
    questions.length > 200 ||
    new Set(questions.map((q) => q.id)).size !== questions.length ||
    questions.some((q) => !Number.isFinite(q.points ?? 1) || (q.points ?? 1) <= 0)
  )
    throw new QuizTraceError('INVALID_QUESTIONS', 400);
  const captured = JSON.parse(JSON.stringify({ scene, ...(planning ? { planning } : {}) }));
  // QuizView presents text and KaTeX. Scene narration/whiteboards are optional
  // background here, not implicit image dependencies discovered from question prose.
  const refs = [
    ...new Set(enumerateAssetManifest({ stage: {}, scenes: [scene] }).entries.map((e) => e.ref)),
  ];
  const metadata = await tx.query<
    { id: string; principal: string; content_hash: string; revision: number } & Record<
      string,
      unknown
    >
  >(
    'SELECT id,principal,content_hash,revision FROM asset_entries WHERE id=ANY($1::text[]) AND principal=ANY($2::text[]) ORDER BY id',
    [refs, assetReferencePrincipalsForOwner(ownerId)],
  );
  const assets = provider.assetStoreIn(tx);
  const available = metadata.rows;
  const unavailable = refs.filter((ref) => !available.some((r) => r.id === ref));
  let digest = digestOf({
    captured,
    resources: available.map((r) => [r.id, r.content_hash, r.revision]),
    unavailable,
  });
  const found = await tx.query<{ data: SceneHistoryVersion } & Record<string, unknown>>(
    'SELECT data FROM scene_history_versions WHERE owner_id=$1 AND stage_id=$2 AND scene_id=$3 AND digest=$4',
    [ownerId, scene.stageId, scene.id, digest],
  );
  if (found.rows[0]) return found.rows[0].data;
  const id = randomUUID();
  const retained = available.length
    ? await assets.cloneRetained(assetPrincipalForOwner(ownerId), {
        sourcePrincipals: assetReferencePrincipalsForOwner(ownerId),
        sourceIds: available.map((r) => r.id),
        holder: { kind: 'scene-history', id },
        skipUnavailable: true,
      })
    : [];
  unavailable.splice(
    0,
    unavailable.length,
    ...refs.filter((ref) => !retained.some((r) => r.sourceId === ref)),
  );
  digest = digestOf({
    captured,
    resources: retained.map((r) => [r.sourceId, r.contentHash, r.sourceRevision]),
    unavailable,
  });
  // Optional byte availability can differ from metadata. Re-check the final key
  // before inserting so a repeated capture shares the same immutable version.
  const finalExisting = await tx.query<{ data: SceneHistoryVersion } & Record<string, unknown>>(
    'SELECT data FROM scene_history_versions WHERE owner_id=$1 AND stage_id=$2 AND scene_id=$3 AND digest=$4',
    [ownerId, scene.stageId, scene.id, digest],
  );
  if (finalExisting.rows[0]) {
    await assets.releaseRetention({ kind: 'scene-history', id });
    for (const copy of retained) await assets.remove(assetPrincipalForOwner(ownerId), copy.assetId);
    return finalExisting.rows[0].data;
  }
  const resources = retained.map((r) => ({ sourceId: r.sourceId, assetId: r.assetId }));
  const frozen: Scene = captured.scene;
  // Rewrite only DSL media slots, never question text or IDs that happen to equal a ref.
  for (const board of frozen.whiteboards ?? []) {
    for (const slot of slideMediaReferenceSlots(board)) {
      const mapped = resources.find((r) => r.sourceId === slot.read());
      if (mapped) slot.write(mapped.assetId);
    }
  }
  for (const action of frozen.actions ?? []) {
    if (action.type === 'speech') {
      const mapped = resources.find((r) => r.sourceId === action.audioId);
      if (mapped) action.audioId = mapped.assetId;
    }
  }
  const version: SceneHistoryVersion = {
    id,
    scene: frozen,
    ...(captured.planning ? { planning: captured.planning } : {}),
    resources,
    resourceCoverage: {
      taskPresentation: 'text-and-math-quiz',
      unavailableBackgroundRefs: unavailable,
    },
    capturedAt: new Date().toISOString(),
  };
  await tx.query(
    'INSERT INTO scene_history_versions(id,owner_id,stage_id,scene_id,digest,data) VALUES($1,$2,$3,$4,$5,$6::jsonb)',
    [id, ownerId, scene.stageId, scene.id, digest, JSON.stringify(version)],
  );
  return version;
}
export async function readSceneVersionIn(
  tx: Queryable,
  ownerId: string,
  id: string,
): Promise<SceneHistoryVersion> {
  const r = await tx.query<{ data: SceneHistoryVersion } & Record<string, unknown>>(
    'SELECT data FROM scene_history_versions WHERE id=$1 AND owner_id=$2',
    [id, ownerId],
  );
  if (!r.rows[0]) throw new QuizTraceError('VERSION_NOT_FOUND', 404);
  return r.rows[0].data;
}
