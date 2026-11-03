import { NextRequest } from 'next/server';
import { withRequestOwner } from '@/lib/server/identity/with-owner';
import { getServerPersistenceProvider } from '@/lib/persistence/server-provider';
import { isSameOriginJsonRequest } from '@/lib/persistence/owner-claim-http';
import { ownerWriteErrorResponse } from '@/lib/persistence/owner-merges';
import { DialogueMemoryStore } from '@/lib/persistence/dialogue-memory-store';
import { DialogueMemoryService } from '@/lib/server/dialogue-memory';
import {
  verifiedDialogueEvidenceIn,
  loadDialogueMemorySettings,
} from '@/lib/server/dialogue-memory-authority';
import { openSimulatedMemory } from '@/lib/server/simulated-memory';
import { SimulatedMemoryEnvironment } from '@/lib/learner-memory/simulated-environment';
import { DIALOGUE_MEMORY_SYSTEM } from '@/lib/learner-memory/dialogue-prompt';
import { resolveModelFromRequest } from '@/lib/server/resolve-model';
import {
  dialogueMemoryModelIdentity,
  invokeDialogueMemoryModel,
  checkDialogueMemoryModelCapacity,
} from '@/lib/server/dialogue-memory-model';
import {
  DialogueMemoryError,
  DIALOGUE_MEMORY_LIMITS,
  deliveryRequestSchema,
  deliveryRecoverySchema,
} from '@/lib/learner-memory/dialogue-contracts';
import { MemoryError } from '@/lib/learner-memory/contracts';
export const runtime = 'nodejs';
export const maxDuration = 240;
async function json(req: Request): Promise<unknown> {
  if (Number(req.headers.get('content-length') ?? 0) > DIALOGUE_MEMORY_LIMITS.requestBytes)
    throw new DialogueMemoryError('PAYLOAD_TOO_LARGE', 413);
  const reader = req.body?.getReader();
  if (!reader) throw new DialogueMemoryError('INVALID_JSON', 400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > DIALOGUE_MEMORY_LIMITS.requestBytes) {
        await reader.cancel();
        throw new DialogueMemoryError('PAYLOAD_TOO_LARGE', 413);
      }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (e) {
    if (e instanceof DialogueMemoryError) throw e;
    throw new DialogueMemoryError('INVALID_JSON', 400);
  }
}
async function handle(req: NextRequest) {
  if (process.env.OPENMAIC_DIALOGUE_MEMORY_ENABLED !== 'true')
    return Response.json({ error: { code: 'NOT_FOUND' } }, { status: 404 });
  return withRequestOwner(req, async (principal, headers) => {
    headers.set('cache-control', 'private, no-store');
    let close: (() => Promise<void>) | undefined;
    try {
      if (req.method !== 'GET' && !isSameOriginJsonRequest(req))
        throw new DialogueMemoryError('INVALID_ORIGIN', 403);
      const path = new URL(req.url).pathname
        .slice('/api/dialogue-memory/'.length)
        .split('/')
        .map(decodeURIComponent);
      if (path[0] !== 'deliveries') throw new DialogueMemoryError('NOT_FOUND', 404);
      const body = req.method === 'GET' ? undefined : await json(req);
      const preparing = req.method === 'POST' && path.length === 1;
      const prepare = preparing ? deliveryRequestSchema.safeParse(body) : null;
      if (preparing && !prepare?.success) throw new DialogueMemoryError('INVALID_REQUEST', 400);
      if (!preparing && (!path[1] || !/^[\w:-]{1,160}$/.test(path[1])))
        throw new DialogueMemoryError('NOT_FOUND', 404);
      const recovery =
        req.method === 'POST' && path.length === 3 && path[2] === 'recover'
          ? deliveryRecoverySchema.safeParse(body)
          : null;
      if (recovery && !recovery.success) throw new DialogueMemoryError('INVALID_REQUEST', 400);
      if (
        !preparing &&
        req.method !== 'GET' &&
        !recovery &&
        (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length)
      )
        throw new DialogueMemoryError('INVALID_REQUEST', 400);
      const owner = principal.ownerId,
        app = await getServerPersistenceProvider(process.env.DATABASE_URL ?? '');
      if (prepare?.success)
        await app.withTransaction(async (tx) => {
          await verifiedDialogueEvidenceIn(
            tx,
            owner,
            prepare.data.evidenceRunId,
            await loadDialogueMemorySettings(),
          );
        });
      else await new DialogueMemoryStore(app).read(owner, path[1]);
      const opened = await openSimulatedMemory();
      close = opened.close;
      const memory = new SimulatedMemoryEnvironment({
        ...opened.memory.provider,
        systemPrompt: DIALOGUE_MEMORY_SYSTEM,
      });
      const service = new DialogueMemoryService(app, memory, loadDialogueMemorySettings);
      if (prepare?.success) {
        const model = await resolveModelFromRequest(req, {}, 'quiz-evidence');
        return Response.json(
          await service.prepare(owner, prepare.data, dialogueMemoryModelIdentity(model)),
          { status: 201, headers },
        );
      }
      if (req.method === 'GET' && path.length === 2)
        return Response.json(await service.read(owner, path[1]), { headers });
      if (recovery?.success)
        return Response.json(await service.recover(owner, path[1], recovery.data), { headers });
      if (req.method === 'POST' && path.length === 3 && path[2] === 'update') {
        const previous = await service.read(owner, path[1]);
        if (previous.delivery.state !== 'prepared') return Response.json(previous, { headers });
        const model = await resolveModelFromRequest(req, {}, 'quiz-evidence');
        if (previous.memoryRun) checkDialogueMemoryModelCapacity(model, previous.memoryRun);
        return Response.json(
          await service.update(owner, path[1], dialogueMemoryModelIdentity(model), (run) =>
            invokeDialogueMemoryModel(model, run),
          ),
          { headers },
        );
      }
      throw new DialogueMemoryError('NOT_FOUND', 404);
    } catch (e) {
      const refusal = ownerWriteErrorResponse(e, headers);
      if (refusal) return refusal;
      return Response.json(
        {
          error: {
            code:
              e instanceof DialogueMemoryError || e instanceof MemoryError
                ? e.code
                : 'DIALOGUE_MEMORY_UNAVAILABLE',
          },
        },
        {
          status:
            e instanceof DialogueMemoryError ? e.status : e instanceof MemoryError ? 409 : 503,
          headers,
        },
      );
    } finally {
      await close?.();
    }
  });
}
export const GET = handle;
export const POST = handle;
