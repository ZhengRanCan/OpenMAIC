import type { NextRequest } from 'next/server';

import { withRequestOwner } from '@/lib/server/identity/with-owner';
import { readClassroomLearnerProfile } from '@/lib/server/learner-profiles';

export const runtime = 'nodejs';

export async function GET(request: NextRequest, context: { params: Promise<{ stageId: string }> }) {
  return withRequestOwner(request, async ({ ownerId }, headers) => {
    headers.set('cache-control', 'private, no-store');
    const { stageId } = await context.params;
    if (!/^[\w-]{1,150}$/.test(stageId)) return new Response(null, { status: 404, headers });
    try {
      const binding = await readClassroomLearnerProfile(ownerId, stageId);
      return binding
        ? Response.json(binding, { headers })
        : new Response(null, { status: 404, headers });
    } catch {
      return new Response(null, { status: 503, headers });
    }
  });
}
