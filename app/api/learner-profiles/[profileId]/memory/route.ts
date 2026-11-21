import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { profileMemoryEdit } from '@/lib/learner-memory/profile-memory-contracts';
import { LearnerProfileError } from '@/lib/persistence/learner-profiles';
import { isSameOriginJsonRequest } from '@/lib/persistence/owner-claim-http';
import { ownerWriteErrorResponse } from '@/lib/persistence/owner-merges';
import { readJsonBody } from '@/lib/server/generation/run/input';
import { withRequestOwner } from '@/lib/server/identity/with-owner';
import { editProfileMemory, readProfileMemory } from '@/lib/server/learner-profile-memory';

export const runtime = 'nodejs';
type Context = { params: Promise<{ profileId: string }> };

async function handle(request: NextRequest, { params }: Context, edit: boolean) {
  return withRequestOwner(request, async ({ ownerId }, headers) => {
    headers.set('cache-control', 'private, no-store');
    const { profileId } = await params;
    if (!z.uuid().safeParse(profileId).success) return new Response(null, { status: 404, headers });
    try {
      if (!edit) return Response.json(await readProfileMemory(ownerId, profileId), { headers });
      if (!isSameOriginJsonRequest(request)) return new Response(null, { status: 403, headers });
      const body = await readJsonBody(request, 24_000);
      if (!body.ok) return new Response(null, { status: body.status, headers });
      const parsed = profileMemoryEdit.safeParse(body.value);
      if (!parsed.success) return new Response(null, { status: 400, headers });
      const saved = await editProfileMemory(ownerId, profileId, parsed.data);
      return saved
        ? Response.json(saved, { headers })
        : new Response(null, { status: 409, headers });
    } catch (error) {
      const refused = ownerWriteErrorResponse(error, headers);
      if (refused) return refused;
      return new Response(null, {
        status: error instanceof LearnerProfileError ? 404 : 503,
        headers,
      });
    }
  });
}

export function GET(request: NextRequest, context: Context) {
  return handle(request, context, false);
}

export function PUT(request: NextRequest, context: Context) {
  return handle(request, context, true);
}
