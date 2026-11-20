import type { NextRequest } from 'next/server';

import { withRequestOwner } from '@/lib/server/identity/with-owner';
import { listLearnerProfiles } from '@/lib/server/learner-profiles';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  return withRequestOwner(request, async ({ ownerId }, headers) => {
    headers.set('cache-control', 'private, no-store');
    try {
      return Response.json({ profiles: await listLearnerProfiles(ownerId) }, { headers });
    } catch {
      return new Response(null, { status: 503, headers });
    }
  });
}
