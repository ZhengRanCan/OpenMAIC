import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { profileMemoryClassroom } from '@/lib/learner-memory/profile-memory-contracts';
import { isSameOriginJsonRequest } from '@/lib/persistence/owner-claim-http';
import { LearnerProfileError } from '@/lib/persistence/learner-profiles';
import { ownerWriteErrorResponse } from '@/lib/persistence/owner-merges';
import { readJsonBody } from '@/lib/server/generation/run/input';
import { withRequestOwner } from '@/lib/server/identity/with-owner';
import {
  listProfileMemoryClassrooms,
  profileMemoryClassroomImport,
} from '@/lib/server/learner-profile-memory';

export const runtime = 'nodejs';
type Context = { params: Promise<{ profileId: string }> };

function handle(request: NextRequest, { params }: Context, enqueue: boolean) {
  return withRequestOwner(request, async ({ ownerId }, headers) => {
    headers.set('cache-control', 'private, no-store');
    const { profileId } = await params;
    if (!z.uuid().safeParse(profileId).success) return new Response(null, { status: 404, headers });
    try {
      let input: unknown;
      if (enqueue) {
        if (!isSameOriginJsonRequest(request)) return new Response(null, { status: 403, headers });
        const body = await readJsonBody(request, 1024);
        if (!body.ok) return new Response(null, { status: body.status, headers });
        input = body.value;
      } else {
        const stageId = request.nextUrl.searchParams.get('stageId');
        if (stageId === null) {
          return Response.json(
            { classrooms: await listProfileMemoryClassrooms(ownerId, profileId) },
            { headers },
          );
        }
        input = { stageId };
      }
      const parsed = profileMemoryClassroom.safeParse(input);
      if (!parsed.success) return new Response(null, { status: 400, headers });
      const status = await profileMemoryClassroomImport(
        ownerId,
        profileId,
        parsed.data.stageId,
        enqueue,
      );
      return status
        ? Response.json(status, { headers, status: enqueue && status.pending ? 202 : 200 })
        : new Response(null, { status: 404, headers });
    } catch (error) {
      return (
        ownerWriteErrorResponse(error, headers) ??
        new Response(null, {
          status: error instanceof LearnerProfileError ? 404 : 503,
          headers,
        })
      );
    }
  });
}

export function GET(request: NextRequest, context: Context) {
  return handle(request, context, false);
}
export function POST(request: NextRequest, context: Context) {
  return handle(request, context, true);
}
