import type { NextRequest } from 'next/server';

import { withRequestOwner } from '@/lib/server/identity/with-owner';
import { readClassroomMastery } from '@/lib/server/learner-mastery';

export const runtime = 'nodejs';

export async function GET(req: NextRequest, context: { params: Promise<{ stageId: string }> }) {
  return withRequestOwner(req, async ({ ownerId }, headers) => {
    headers.set('cache-control', 'private, no-store');
    const { stageId } = await context.params;
    if (!/^[\w-]{1,150}$/.test(stageId)) return new Response(null, { status: 404, headers });
    try {
      const mastery = await readClassroomMastery(ownerId, stageId);
      if (!mastery) return new Response(null, { status: 404, headers });
      return Response.json(mastery, { headers });
    } catch {
      return Response.json({ error: { code: 'MASTERY_READ_FAILED' } }, { status: 503, headers });
    }
  });
}
