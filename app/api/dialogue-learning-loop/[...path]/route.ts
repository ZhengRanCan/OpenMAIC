import { NextRequest } from 'next/server';
import { withRequestOwner } from '@/lib/server/identity/with-owner';
import { isSameOriginJsonRequest } from '@/lib/persistence/owner-claim-http';
import { ownerWriteErrorResponse } from '@/lib/persistence/owner-merges';
import { getServerPersistenceProvider } from '@/lib/persistence/server-provider';
import { readDialogueLoopConfig } from '@/lib/server/dialogue-learning-loop/config';
import {
  DialogueLoopStore,
  refreshLoopStageStatesIn,
} from '@/lib/server/dialogue-learning-loop/store';
import { withDialogueLoopDeps } from '@/lib/server/dialogue-learning-loop/adapter';
import { recoverDialogueJob } from '@/lib/server/dialogue-learning-loop/recovery';
import {
  DialogueLoopError,
  loopId,
  recoverySchema,
  projectLoopStatus,
  type DialogueLoopJob,
} from '@/lib/dialogue/learning-loop-contracts';
import { DialogueEvidenceError } from '@/lib/dialogue/evidence-contracts';
import { DialogueMemoryError } from '@/lib/learner-memory/dialogue-contracts';
export const runtime = 'nodejs';
async function body(req: Request) {
  if (Number(req.headers.get('content-length') ?? 0) > 16384)
    throw new DialogueLoopError('PAYLOAD_TOO_LARGE', 413);
  const reader = req.body?.getReader();
  if (!reader) throw new DialogueLoopError('INVALID_JSON', 400);
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const r = await reader.read();
      if (r.done) break;
      size += r.value.byteLength;
      if (size > 16384) {
        await reader.cancel();
        throw new DialogueLoopError('PAYLOAD_TOO_LARGE', 413);
      }
      chunks.push(r.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (e) {
    if (e instanceof DialogueLoopError) throw e;
    throw new DialogueLoopError('INVALID_JSON', 400);
  }
}
async function handle(req: NextRequest) {
  if (process.env.OPENMAIC_AUTOMATIC_DIALOGUE_LOOP !== 'true')
    return new Response(null, { status: 204, headers: { 'cache-control': 'private, no-store' } });
  return withRequestOwner(req, async (principal, headers) => {
    headers.set('cache-control', 'private, no-store');
    try {
      const config = readDialogueLoopConfig();
      if (!config) throw new DialogueLoopError('NOT_FOUND', 404);
      const url = new URL(req.url),
        path = url.pathname
          .slice('/api/dialogue-learning-loop/'.length)
          .split('/')
          .map(decodeURIComponent);
      if (req.method !== 'GET' && !isSameOriginJsonRequest(req))
        throw new DialogueLoopError('INVALID_ORIGIN', 403);
      const isStatus = req.method === 'GET' && path.length === 1 && path[0] === 'status';
      const recovery =
        req.method === 'POST' &&
        path.length === 3 &&
        path[0] === 'jobs' &&
        path[2] === 'recover' &&
        loopId.safeParse(path[1]).success
          ? recoverySchema.safeParse(await body(req))
          : null;
      if (recovery && !recovery.success) throw new DialogueLoopError('INVALID_REQUEST', 400);
      if (!isStatus && !recovery) throw new DialogueLoopError('NOT_FOUND', 404);
      const owner = principal.ownerId;
      const stage = url.searchParams.get('stageId'),
        session = url.searchParams.get('chatSessionId');
      if (isStatus && (!loopId.safeParse(stage).success || !loopId.safeParse(session).success))
        throw new DialogueLoopError('INVALID_REQUEST', 400);
      const app = await getServerPersistenceProvider(process.env.DATABASE_URL ?? '');
      if (isStatus) {
        const row = await app.withTransaction(async (tx) => {
          await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
          const access = await tx.query(
            'SELECT stage_id FROM stage_meta WHERE stage_id=$1 AND owner_id=$2 AND deleted_at IS NULL',
            [stage, owner],
          );
          if (!access.rows.length) throw new DialogueLoopError('NOT_FOUND', 404);
          const rows = await tx.query(
            'SELECT data FROM dialogue_loop_jobs WHERE owner_id=$1 AND stage_id=$2 AND chat_session_id=$3 ORDER BY created_at DESC,id DESC LIMIT 1',
            [owner, stage, session],
          );
          return rows.rows.length
            ? await refreshLoopStageStatesIn(tx, rows.rows[0].data as DialogueLoopJob)
            : null;
        });
        if (!row) return Response.json({ job: null }, { headers });
        return Response.json({ job: projectLoopStatus(row) }, { headers });
      }
      const job = await new DialogueLoopStore(app).read(owner, path[1]);
      const status = await withDialogueLoopDeps(job, app, config, (d) =>
        recoverDialogueJob(owner, job.id, recovery!.data!, d),
      );
      return Response.json({ job: status }, { headers });
    } catch (e) {
      const refusal = ownerWriteErrorResponse(e, headers);
      if (refusal) return refusal;
      const known =
        e instanceof DialogueLoopError ||
        e instanceof DialogueEvidenceError ||
        e instanceof DialogueMemoryError;
      return Response.json(
        { error: { code: known ? e.code : 'DIALOGUE_LOOP_UNAVAILABLE' } },
        { status: known ? e.status : 503, headers },
      );
    }
  });
}
export const GET = handle;
export const POST = handle;
