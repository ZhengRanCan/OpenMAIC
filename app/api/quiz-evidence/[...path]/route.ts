import { NextRequest } from 'next/server';
import { withRequestOwner } from '@/lib/server/identity/with-owner';
import { isSameOriginJsonRequest } from '@/lib/persistence/owner-claim-http';
import { getServerPersistenceProvider } from '@/lib/persistence/server-provider';
import { QuizEvidenceStore } from '@/lib/persistence/quiz-evidence-store';
import { readEvidenceRun, readEvidenceOperation } from '@/lib/persistence/quiz-evidence-read';
import { organizeQuizEvidence } from '@/lib/server/quiz-evidence';
import { loadEvidenceSettings } from '@/lib/server/evidence-provenance';
import { resolveModelFromRequest } from '@/lib/server/resolve-model';
import {
  EvidenceError,
  EVIDENCE_LIMITS,
  parseOrganizeRequest,
  parseEvidenceRestriction,
  evidenceIdSchema,
} from '@/lib/evidence/contracts';

export const runtime = 'nodejs';
export const maxDuration = 240;

async function jsonBody(req: Request): Promise<unknown> {
  const announced = Number(req.headers.get('content-length') ?? 0);
  if (announced > EVIDENCE_LIMITS.requestBytes) throw new EvidenceError('PAYLOAD_TOO_LARGE', 413);
  const reader = req.body?.getReader();
  if (!reader) throw new EvidenceError('INVALID_JSON', 400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > EVIDENCE_LIMITS.requestBytes) {
        await reader.cancel();
        throw new EvidenceError('PAYLOAD_TOO_LARGE', 413);
      }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (e) {
    if (e instanceof EvidenceError) throw e;
    throw new EvidenceError('INVALID_JSON', 400);
  }
}

async function handle(req: NextRequest) {
  if (process.env.OPENMAIC_EVIDENCE_ENABLED !== 'true')
    return Response.json(
      { error: { code: 'NOT_FOUND' } },
      { status: 404, headers: { 'cache-control': 'private, no-store' } },
    );
  return withRequestOwner(req, async (principal, headers) => {
    headers.set('cache-control', 'private, no-store');
    let operationId: string | undefined;
    try {
      if (req.method !== 'GET' && !isSameOriginJsonRequest(req))
        throw new EvidenceError('INVALID_ORIGIN', 403);
      const parts = new URL(req.url).pathname
        .slice('/api/quiz-evidence/'.length)
        .split('/')
        .map(decodeURIComponent);
      const body = req.method === 'GET' ? undefined : await jsonBody(req);
      const organize =
        req.method === 'POST' && parts.length === 1 && parts[0] === 'runs'
          ? parseOrganizeRequest(body)
          : undefined;
      if (organize) operationId = organize.operationId;
      if (!organize && (!parts[1] || !evidenceIdSchema.safeParse(parts[1]).success))
        throw new EvidenceError('NOT_FOUND', 404);
      const provider = await getServerPersistenceProvider(process.env.DATABASE_URL ?? '');
      const owner = principal.ownerId;
      if (organize) {
        const result = await organizeQuizEvidence(
          provider,
          principal,
          organize,
          () => resolveModelFromRequest(req, {}, 'quiz-evidence'),
          loadEvidenceSettings,
        );
        return Response.json(result.run, { status: result.status, headers });
      }
      if (req.method === 'GET' && parts.length === 2) {
        if (parts[0] === 'runs')
          return Response.json(await readEvidenceRun(provider, owner, parts[1]), { headers });
        if (parts[0] === 'operations')
          return Response.json(await readEvidenceOperation(provider, owner, parts[1]), { headers });
      }
      const store = new QuizEvidenceStore(provider);
      if (req.method === 'DELETE' && parts[0] === 'runs' && parts.length === 2) {
        if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length)
          throw new EvidenceError('INVALID_REQUEST', 400);
        await store.delete(owner, parts[1]);
        return new Response(null, { status: 204, headers });
      }
      if (
        req.method === 'POST' &&
        parts[0] === 'runs' &&
        parts[2] === 'restrictions' &&
        parts.length === 3
      ) {
        await store.restrict(owner, parts[1], parseEvidenceRestriction(body));
        return Response.json(await readEvidenceRun(provider, owner, parts[1]), { headers });
      }
      throw new EvidenceError('NOT_FOUND', 404);
    } catch (e) {
      return Response.json(
        {
          error: { code: e instanceof EvidenceError ? e.code : 'EVIDENCE_UNAVAILABLE' },
          ...(operationId ? { operationId } : {}),
        },
        { status: e instanceof EvidenceError ? e.status : 503, headers },
      );
    }
  });
}
export const GET = handle;
export const POST = handle;
export const DELETE = handle;
