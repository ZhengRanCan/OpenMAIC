import type { NextRequest } from 'next/server';
import { z } from 'zod';

import { isSameOriginJsonRequest } from '@/lib/persistence/owner-claim-http';
import { ownerWriteErrorResponse } from '@/lib/persistence/owner-merges';
import { withRequestOwner } from '@/lib/server/identity/with-owner';
import { readClassroomMastery } from '@/lib/server/learner-mastery';
import { requestProfileMasteryUpdate } from '@/lib/server/learner-profile-mastery-runner';

export const runtime = 'nodejs';
type Context = { params: Promise<{ stageId: string }> };
const stageIdPattern = /^[\w-]{1,150}$/;

export async function GET(req: NextRequest, context: Context) {
  return withRequestOwner(req, async ({ ownerId }, headers) => {
    headers.set('cache-control', 'private, no-store');
    const { stageId } = await context.params;
    if (!stageIdPattern.test(stageId)) return new Response(null, { status: 404, headers });
    try {
      const mastery = await readClassroomMastery(ownerId, stageId);
      if (!mastery) return new Response(null, { status: 404, headers });
      return Response.json(mastery, { headers });
    } catch {
      return Response.json({ error: { code: 'MASTERY_READ_FAILED' } }, { status: 503, headers });
    }
  });
}

const updateRequest = z.strictObject({
  target: z
    .strictObject({
      id: z.string().min(1).max(150),
      revision: z.number().int().min(1).max(999_999_999),
    })
    .optional(),
});

export async function POST(req: NextRequest, context: Context) {
  return withRequestOwner(req, async ({ ownerId }, headers) => {
    headers.set('cache-control', 'private, no-store');
    if (!isSameOriginJsonRequest(req)) return new Response(null, { status: 403, headers });
    const { stageId } = await context.params;
    if (!stageIdPattern.test(stageId)) return new Response(null, { status: 404, headers });
    const body = updateRequest.safeParse(await req.json().catch(() => null));
    if (!body.success) return new Response(null, { status: 400, headers });
    try {
      const status = await requestProfileMasteryUpdate(ownerId, stageId, body.data.target);
      if (status === 'unavailable') return new Response(null, { status: 404, headers });
      return Response.json({ status }, { headers });
    } catch (error) {
      return (
        ownerWriteErrorResponse(error, headers) ?? new Response(null, { status: 503, headers })
      );
    }
  });
}
