import { NextRequest } from 'next/server';
import { withRequestOwner } from '@/lib/server/identity/with-owner';
import { isSameOriginJsonRequest } from '@/lib/persistence/owner-claim-http';
import { ownerWriteErrorResponse } from '@/lib/persistence/owner-merges';
import { getServerPersistenceProvider } from '@/lib/persistence/server-provider';
import { DialogueEvidenceStore } from '@/lib/persistence/dialogue-evidence-store';
import { readDialogueEvidenceRun } from '@/lib/persistence/dialogue-evidence-read';
import { loadDialogueEvidenceSettings } from '@/lib/server/dialogue-evidence-provenance';
import { resolveModelFromRequest } from '@/lib/server/resolve-model';
import {
  dialogueModelIdentity,
  extractDialogueEvidence,
  invokeDialogueModel,
} from '@/lib/server/dialogue-evidence';
import {
  DIALOGUE_LIMITS,
  DialogueEvidenceError,
  dialogueId,
  prepareDialogueSchema,
  recoverySchema,
} from '@/lib/dialogue/evidence-contracts';

export const runtime = 'nodejs';
export const maxDuration = 240;
async function body(req: Request): Promise<unknown> {
  if (Number(req.headers.get('content-length') ?? 0) > DIALOGUE_LIMITS.requestBytes)
    throw new DialogueEvidenceError('PAYLOAD_TOO_LARGE', 413);
  const reader = req.body?.getReader();
  if (!reader) throw new DialogueEvidenceError('INVALID_JSON', 400);
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > DIALOGUE_LIMITS.requestBytes) {
        await reader.cancel();
        throw new DialogueEvidenceError('PAYLOAD_TOO_LARGE', 413);
      }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (e) {
    if (e instanceof DialogueEvidenceError) throw e;
    throw new DialogueEvidenceError('INVALID_JSON', 400);
  }
}
function empty(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length)
    throw new DialogueEvidenceError('INVALID_REQUEST', 400);
}
async function handle(req: NextRequest) {
  if (process.env.OPENMAIC_DIALOGUE_EVIDENCE_ENABLED !== 'true')
    return Response.json({ error: { code: 'NOT_FOUND' } }, { status: 404 });
  return withRequestOwner(req, async (principal, headers) => {
    headers.set('cache-control', 'private, no-store');
    try {
      if (req.method !== 'GET' && !isSameOriginJsonRequest(req))
        throw new DialogueEvidenceError('INVALID_ORIGIN', 403);
      const path = new URL(req.url).pathname
        .slice('/api/dialogue-evidence/'.length)
        .split('/')
        .map(decodeURIComponent);
      if (path[0] !== 'runs') throw new DialogueEvidenceError('NOT_FOUND', 404);
      const value = req.method === 'GET' ? undefined : await body(req);
      const isPrepare = req.method === 'POST' && path.length === 1;
      const prepare = isPrepare ? prepareDialogueSchema.safeParse(value) : null;
      if (isPrepare && !prepare?.success) throw new DialogueEvidenceError('INVALID_REQUEST', 400);
      if (!isPrepare && (!path[1] || !dialogueId.safeParse(path[1]).success))
        throw new DialogueEvidenceError('NOT_FOUND', 404);
      const recovery =
        req.method === 'POST' && path.length === 3 && path[2] === 'recover'
          ? recoverySchema.safeParse(value)
          : null;
      if (recovery && !recovery.success) throw new DialogueEvidenceError('INVALID_REQUEST', 400);
      if (!isPrepare && req.method !== 'GET' && !recovery) empty(value);
      const provider = await getServerPersistenceProvider(process.env.DATABASE_URL ?? '');
      const owner = principal.ownerId,
        store = new DialogueEvidenceStore(provider);
      const read = () => readDialogueEvidenceRun(provider, owner, path[1]);
      if (prepare?.success) {
        const settings = await loadDialogueEvidenceSettings();
        const model = await resolveModelFromRequest(req, {}, 'quiz-evidence');
        const result = await store.prepare(
          owner,
          prepare.data,
          settings,
          dialogueModelIdentity(model),
        );
        return Response.json(await readDialogueEvidenceRun(provider, owner, result.id), {
          status: 201,
          headers,
        });
      }
      if (req.method === 'GET' && path.length === 2)
        return Response.json(await read(), { headers });
      if (req.method === 'DELETE' && path.length === 2) {
        await store.delete(owner, path[1]);
        return new Response(null, { status: 204, headers });
      }
      if (recovery?.success) {
        const next = await store.recover(
          owner,
          path[1],
          recovery.data,
          await loadDialogueEvidenceSettings(),
        );
        return Response.json(await readDialogueEvidenceRun(provider, owner, next.id), { headers });
      }
      if (req.method === 'POST' && path.length === 3 && path[2] === 'extract') {
        const current = await read();
        if (!['prepared', 'captured'].includes(current.state))
          return Response.json(current, { headers });
        if (current.state === 'captured') {
          await store.finalize(owner, current.id);
          return Response.json(await read(), { headers });
        }
        const model = await resolveModelFromRequest(req, {}, 'quiz-evidence');
        const result = await extractDialogueEvidence(
          owner,
          path[1],
          dialogueModelIdentity(model),
          store,
          read,
          (run) => invokeDialogueModel(model, run),
          loadDialogueEvidenceSettings,
        );
        return Response.json(result, { status: result.state === 'calling' ? 202 : 200, headers });
      }
      throw new DialogueEvidenceError('NOT_FOUND', 404);
    } catch (error) {
      const refusal = ownerWriteErrorResponse(error, headers);
      if (refusal) return refusal;
      return Response.json(
        {
          error: {
            code:
              error instanceof DialogueEvidenceError ? error.code : 'DIALOGUE_EVIDENCE_UNAVAILABLE',
          },
        },
        { status: error instanceof DialogueEvidenceError ? error.status : 503, headers },
      );
    }
  });
}
export const POST = handle;
export const GET = handle;
export const DELETE = handle;
