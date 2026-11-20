import type { NextRequest } from 'next/server';
import { z } from 'zod';

import { learnerProfileNameSchema } from '@/lib/learner-context/learner-profile-contracts';
import { LearnerProfileError } from '@/lib/persistence/learner-profiles';
import { isSameOriginJsonRequest } from '@/lib/persistence/owner-claim-http';
import { ownerWriteErrorResponse } from '@/lib/persistence/owner-merges';
import { readJsonBody } from '@/lib/server/generation/run/input';
import { withRequestOwner } from '@/lib/server/identity/with-owner';
import { nameLearnerProfile } from '@/lib/server/learner-profiles';

export const runtime = 'nodejs';

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ profileId: string }> },
) {
  return withRequestOwner(request, async ({ ownerId }, headers) => {
    headers.set('cache-control', 'private, no-store');
    if (!isSameOriginJsonRequest(request)) return new Response(null, { status: 403, headers });
    const { profileId } = await context.params;
    if (!z.uuid().safeParse(profileId).success) return new Response(null, { status: 404, headers });
    try {
      const body = await readJsonBody(request, 1024);
      if (!body.ok) return new Response(null, { status: body.status, headers });
      const parsed = z.strictObject({ name: learnerProfileNameSchema }).safeParse(body.value);
      if (!parsed.success) return new Response(null, { status: 400, headers });
      return Response.json(await nameLearnerProfile(ownerId, profileId, parsed.data.name), {
        headers,
      });
    } catch (error) {
      const ownerRefusal = ownerWriteErrorResponse(error, headers);
      if (ownerRefusal) return ownerRefusal;
      if (error instanceof LearnerProfileError) {
        return new Response(null, { status: error.code === 'unavailable' ? 404 : 409, headers });
      }
      return new Response(null, { status: 503, headers });
    }
  });
}
