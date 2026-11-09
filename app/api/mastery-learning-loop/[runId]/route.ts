import type { NextRequest } from 'next/server';
import { isSameOriginJsonRequest } from '@/lib/persistence/owner-claim-http';
import { ownerWriteErrorResponse } from '@/lib/persistence/owner-merges';
import { getServerPersistenceProvider } from '@/lib/persistence/server-provider';
import { withRequestOwner } from '@/lib/server/identity/with-owner';
import {
  loadAutomaticMasterySettings,
  MasteryLearningLoop,
  readAutomaticMasteryConfig,
} from '@/lib/server/mastery-learning-loop';

export const runtime = 'nodejs';
type Context = { params: Promise<{ runId: string }> };

async function handle(req: NextRequest, context: Context) {
  return withRequestOwner(req, async ({ ownerId }, headers) => {
    headers.set('cache-control', 'private, no-store');
    try {
      const config = readAutomaticMasteryConfig();
      if (!config) return new Response(null, { status: 404, headers });
      const { runId } = await context.params;
      if (!/^[\w-]{1,150}$/.test(runId)) return new Response(null, { status: 400, headers });
      if (req.method === 'POST' && !isSameOriginJsonRequest(req))
        return new Response(null, { status: 403, headers });
      const loop = new MasteryLearningLoop(
        await getServerPersistenceProvider(process.env.DATABASE_URL ?? ''),
        await loadAutomaticMasterySettings(config.memoryEnvironmentId),
      );
      if (req.method === 'POST') {
        const id = req.nextUrl.searchParams.get('job');
        const action = req.nextUrl.searchParams.get('action');
        if (
          !id ||
          !/^[\da-f-]{36}$/i.test(id) ||
          (action !== 'retry' && action !== 'reconcile' && action !== 'discard_unknown')
        )
          return new Response(null, { status: 400, headers });
        if (!(await loop.recover(ownerId, runId, id, action)))
          return new Response(null, { status: 409, headers });
      }
      return Response.json({ jobs: await loop.status(ownerId, runId) }, { headers });
    } catch (error) {
      const refusal = ownerWriteErrorResponse(error, headers);
      if (refusal) return refusal;
      const conflict =
        error instanceof Error &&
        ['MASTERY_REPLY_CAPTURED', 'MASTERY_RECOVERY_CONFLICT'].includes(error.message);
      return Response.json(
        { error: { code: conflict ? error.message : 'MASTERY_LOOP_UNAVAILABLE' } },
        { status: conflict ? 409 : 503, headers },
      );
    }
  });
}

export const GET = handle;
export const POST = handle;
