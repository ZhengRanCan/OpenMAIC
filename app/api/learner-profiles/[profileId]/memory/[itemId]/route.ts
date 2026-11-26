import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { LearnerProfileError } from '@/lib/persistence/learner-profiles';
import { isSameOriginJsonRequest } from '@/lib/persistence/owner-claim-http';
import { ownerWriteErrorResponse } from '@/lib/persistence/owner-merges';
import { readJsonBody } from '@/lib/server/generation/run/input';
import { withRequestOwner } from '@/lib/server/identity/with-owner';
import { flagProfileMemory, readProfileMemoryBasis } from '@/lib/server/learner-profile-memory';

export const runtime = 'nodejs';
type Context = { params: Promise<{ profileId: string; itemId: string }> };
const version = z
  .string()
  .regex(/^[a-f0-9]{64}$/)
  .optional();
const flagBody = z.strictObject({ flagged: z.literal(true), version });

async function handle(request: NextRequest, { params }: Context, flag: boolean) {
  return withRequestOwner(request, async ({ ownerId }, headers) => {
    headers.set('cache-control', 'private, no-store');
    const { profileId, itemId } = await params;
    if (![profileId, itemId].every((value) => z.uuid().safeParse(value).success))
      return new Response(null, { status: 404, headers });
    try {
      if (!flag) {
        const expected = version.safeParse(
          request.nextUrl.searchParams.get('version') ?? undefined,
        );
        if (!expected.success) return new Response(null, { status: 400, headers });
        const basis = await readProfileMemoryBasis(ownerId, profileId, itemId, expected.data);
        if (basis === 'conflict') return new Response(null, { status: 409, headers });
        return basis
          ? Response.json(basis, { headers })
          : new Response(null, { status: 404, headers });
      }
      if (!isSameOriginJsonRequest(request)) return new Response(null, { status: 403, headers });
      const body = await readJsonBody(request, 128);
      if (!body.ok) return new Response(null, { status: body.status, headers });
      const parsed = flagBody.safeParse(body.value);
      if (!parsed.success) return new Response(null, { status: 400, headers });
      const changed = await flagProfileMemory(ownerId, profileId, itemId, parsed.data.version);
      if (changed === 'conflict') return new Response(null, { status: 409, headers });
      return new Response(null, { status: changed ? 204 : 404, headers });
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

export function PATCH(request: NextRequest, context: Context) {
  return handle(request, context, true);
}
