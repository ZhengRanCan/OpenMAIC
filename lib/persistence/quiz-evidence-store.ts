import { randomUUID } from 'node:crypto';
import type { Queryable } from '@openmaic/storage/document/pg';
import type { ServerPersistenceProvider } from './server-provider';
import { fenceOwnerWrite, forwardOwnerWrite } from './owner-merges';
import { readPreparedIn } from './quiz-trace';
import { evidenceRunIn, inspectEvidenceSourcesIn } from './quiz-evidence-read';
import { buildEvidenceContext, evidenceDigest } from '@/lib/evidence/context';
import { matchEvidenceProvenance } from '@/lib/server/evidence-provenance';
import { buildEvidencePrompt } from '@/lib/evidence/prompt';
import { validateEvidenceOutput } from '@/lib/evidence/validation';
import {
  EvidenceError,
  EVIDENCE_LIMITS,
  type OrganizeEvidenceRequest,
  type EvidenceRun,
  type EvidenceModelIdentity,
  type EvidenceSettings,
  type EvidenceReservation,
  type EvidenceInvocationClaim,
  type EvidenceCapturedReply,
  type EvidenceRestriction,
} from '@/lib/evidence/contracts';

function intent(request: OrganizeEvidenceRequest) {
  const { operationId: _operationId, ...value } = request;
  return evidenceDigest({
    ...value,
    related: [...value.related].sort((a, b) => a.attemptId.localeCompare(b.attemptId)),
  });
}
async function stageIn(tx: Queryable, owner: string, stageId: string) {
  const result = await tx.query(
    'SELECT stage_id FROM stage_meta WHERE stage_id=$1 AND owner_id=$2 AND deleted_at IS NULL FOR UPDATE',
    [stageId, owner],
  );
  if (!result.rows.length) throw new EvidenceError('STAGE_NOT_FOUND', 404);
}
async function receiptIn(
  tx: Queryable,
  owner: string,
  request: OrganizeEvidenceRequest,
): Promise<EvidenceRun | null> {
  const result = await tx.query<
    { intent_digest: string; run_id: string | null; deleted_at: string | null } & Record<
      string,
      unknown
    >
  >(
    'SELECT intent_digest,run_id,deleted_at FROM quiz_evidence_requests WHERE owner_id=$1 AND operation_id=$2',
    [owner, request.operationId],
  );
  const row = result.rows[0];
  if (!row) return null;
  if (row.intent_digest !== intent(request)) throw new EvidenceError('OPERATION_CONFLICT');
  if (row.deleted_at || !row.run_id) throw new EvidenceError('EVIDENCE_DELETED', 410);
  return evidenceRunIn(tx, owner, row.run_id);
}
async function saveIn(tx: Queryable, owner: string, run: EvidenceRun) {
  run.updatedAt = new Date().toISOString();
  await tx.query(
    'UPDATE quiz_evidence_runs SET state=$3,data=$4::jsonb,updated_at=$5 WHERE id=$1 AND owner_id=$2',
    [run.id, owner, run.state, JSON.stringify(run), run.updatedAt],
  );
}

export class QuizEvidenceStore {
  constructor(readonly provider: ServerPersistenceProvider) {}
  async lookupRequest(
    owner: string,
    request: OrganizeEvidenceRequest,
  ): Promise<EvidenceRun | null> {
    return this.provider.withTransaction(async (tx) => {
      await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
      return receiptIn(tx, owner, request);
    });
  }
  async reserve(
    owner: string,
    request: OrganizeEvidenceRequest,
    model: EvidenceModelIdentity,
    settings: EvidenceSettings,
  ): Promise<EvidenceReservation> {
    return this.provider
      .withTransaction<EvidenceReservation>(async (tx) => {
        await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
        await fenceOwnerWrite(tx, owner);
        await stageIn(tx, owner, request.stageId);
        const prior = await receiptIn(tx, owner, request);
        if (prior) return { kind: 'existing', run: prior };
        const selected = [request.anchor, ...request.related];
        const sources = new Map<string, Awaited<ReturnType<typeof readPreparedIn>>>();
        for (const ref of [...selected].sort((a, b) => a.attemptId.localeCompare(b.attemptId))) {
          const source = await readPreparedIn(tx, owner, ref.attemptId);
          if (
            source.stageId !== request.stageId ||
            source.submission?.id !== ref.submissionId ||
            source.submission.attemptId !== ref.attemptId ||
            source.submission.versionId !== source.version.id
          )
            throw new EvidenceError('SOURCE_SCOPE_CONFLICT');
          sources.set(ref.attemptId, source);
        }
        const anchor = sources.get(request.anchor.attemptId)!;
        const related = request.related.map((ref) => sources.get(ref.attemptId)!);
        if (related.some((x) => x.sceneId !== anchor.sceneId || x.version.id !== anchor.version.id))
          throw new EvidenceError('SOURCE_SCOPE_CONFLICT');
        const conditions = [...sources.values()].flatMap((source) =>
          matchEvidenceProvenance(source, settings.provenance),
        );
        const sourceEnvelope = {
          schemaVersion: 1 as const,
          capturedAt: new Date().toISOString(),
          anchor,
          related,
          conditions,
          provenanceDigest: settings.provenanceDigest,
        };
        const context = buildEvidenceContext(sourceEnvelope);
        const prompt = buildEvidencePrompt(request.language);
        const reuseKey = evidenceDigest({
          context,
          language: request.language,
          model,
          prompt,
          provenanceDigest: settings.provenanceDigest,
          budgets: {
            maxOutputTokens: settings.maxOutputTokens,
            timeoutMs: settings.timeoutMs,
            leaseMs: settings.leaseMs,
          },
          contextVersion: settings.contextVersion,
          schemaVersion: settings.schemaVersion,
        });
        if (request.action === 'reanalyze') {
          const previous = await evidenceRunIn(tx, owner, request.previousRunId!);
          if (
            previous.stageId !== request.stageId ||
            previous.request.anchor.attemptId !== request.anchor.attemptId ||
            previous.request.anchor.submissionId !== request.anchor.submissionId
          )
            throw new EvidenceError('PREVIOUS_RUN_SCOPE_CONFLICT');
        }
        const recent = await tx.query<{ id: string } & Record<string, unknown>>(
          'SELECT id FROM quiz_evidence_runs WHERE owner_id=$1 AND stage_id=$2 ORDER BY created_at DESC,id',
          [owner, request.stageId],
        );
        let reusable: EvidenceRun | undefined;
        let hasUnknownExecution = false;
        for (const row of recent.rows) {
          const run = await evidenceRunIn(tx, owner, row.id);
          const expired =
            run.state === 'calling' &&
            run.leaseExpiresAt &&
            Date.parse(run.leaseExpiresAt) <= Date.now();
          if (expired && request.action === 'reanalyze') {
            run.state = 'interrupted';
            run.errorCode = 'EXECUTION_UNKNOWN';
            await saveIn(tx, owner, run);
          }
          if (
            request.action === 'reanalyze' &&
            run.id === request.previousRunId &&
            run.state === 'reserved'
          ) {
            run.state = 'interrupted';
            run.errorCode = 'SUPERSEDED_BEFORE_CALL';
            await saveIn(tx, owner, run);
          }
          if (
            request.action === 'reuse-or-create' &&
            run.request.anchor.attemptId === request.anchor.attemptId &&
            ((run.state === 'interrupted' && run.errorCode !== 'SUPERSEDED_BEFORE_CALL') || expired)
          )
            hasUnknownExecution = true;
          if (['reserved', 'calling', 'generated'].includes(run.state) && !expired) {
            if (
              request.action === 'reuse-or-create' &&
              run.reuseKey === reuseKey &&
              !run.restrictions.length
            )
              reusable = run;
            else throw new EvidenceError('EVIDENCE_BUSY');
          }
          if (
            request.action === 'reuse-or-create' &&
            !reusable &&
            ['completed', 'partial'].includes(run.state) &&
            run.reuseKey === reuseKey &&
            !run.restrictions.length
          ) {
            const check = await inspectEvidenceSourcesIn(tx, owner, run);
            if (
              !check.unavailable &&
              !check.sourceChanges.some((x) => x.code !== 'AVAILABLE_NOT_INCLUDED')
            )
              reusable = run;
          }
        }
        if (!reusable && hasUnknownExecution) throw new EvidenceError('EXECUTION_UNKNOWN');
        const now = new Date().toISOString();
        const run: EvidenceRun = reusable ?? {
          id: randomUUID(),
          stageId: request.stageId,
          state: 'reserved',
          ...(request.previousRunId ? { previousRunId: request.previousRunId } : {}),
          sourceEnvelope,
          context,
          modelIdentity: model,
          restrictions: [],
          createdAt: now,
          updatedAt: now,
          semanticStatus: 'unreviewed',
          adoptionAllowed: false,
          request,
          reuseKey,
          prompt,
        };
        if (!reusable)
          await tx.query(
            'INSERT INTO quiz_evidence_runs(id,owner_id,stage_id,anchor_attempt_id,reuse_key,state,previous_run_id,data) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)',
            [
              run.id,
              owner,
              request.stageId,
              anchor.attemptId,
              reuseKey,
              run.state,
              request.previousRunId ?? null,
              JSON.stringify(run),
            ],
          );
        await tx.query(
          'INSERT INTO quiz_evidence_requests(owner_id,operation_id,stage_id,intent_digest,run_id) VALUES($1,$2,$3,$4,$5)',
          [owner, request.operationId, request.stageId, intent(request), run.id],
        );
        return { kind: reusable ? 'existing' : 'reserved', run };
      })
      .catch((error) => {
        if (
          error &&
          typeof error === 'object' &&
          'code' in error &&
          ['23505', '40001', '40P01'].includes(String(error.code))
        )
          throw new EvidenceError('CONCURRENT_EVIDENCE_UPDATE', 409);
        throw error;
      });
  }
  private async locked<T>(
    owner: string,
    runId: string,
    body: (tx: Queryable, run: EvidenceRun) => Promise<T>,
  ): Promise<T> {
    return this.provider.withTransaction(async (tx) => {
      await fenceOwnerWrite(tx, owner);
      const found = await evidenceRunIn(tx, owner, runId);
      await stageIn(tx, owner, found.stageId);
      return body(tx, await evidenceRunIn(tx, owner, runId, true));
    });
  }
  async claim(owner: string, runId: string): Promise<EvidenceInvocationClaim | null> {
    return this.locked(owner, runId, async (tx, run) => {
      if (run.state !== 'reserved') return null;
      const token = randomUUID(),
        leaseExpiresAt = new Date(Date.now() + EVIDENCE_LIMITS.leaseMs).toISOString();
      run.state = 'calling';
      run.invocationToken = token;
      run.leaseExpiresAt = leaseExpiresAt;
      await tx.query(
        'UPDATE quiz_evidence_runs SET invocation_token=$3,lease_expires_at=$4 WHERE id=$1 AND owner_id=$2',
        [runId, owner, token, leaseExpiresAt],
      );
      await saveIn(tx, owner, run);
      return { runId, token, leaseExpiresAt };
    });
  }
  async capture(
    startingOwner: string,
    claim: EvidenceInvocationClaim,
    reply: EvidenceCapturedReply,
  ): Promise<string> {
    // Idempotent same-byte capture makes a lost COMMIT response safe to retry without another LLM call.
    return this.provider.withTransaction(async (tx) => {
      const owner = await forwardOwnerWrite(tx, startingOwner);
      const found = await evidenceRunIn(tx, owner, claim.runId);
      await stageIn(tx, owner, found.stageId);
      const run = await evidenceRunIn(tx, owner, claim.runId, true);
      if (
        run.invocationToken === claim.token &&
        run.reply &&
        evidenceDigest(run.reply) === evidenceDigest(reply) &&
        ['generated', 'completed', 'partial', 'failed'].includes(run.state)
      )
        return owner;
      if (
        run.state !== 'calling' ||
        run.invocationToken !== claim.token ||
        !run.leaseExpiresAt ||
        Date.parse(run.leaseExpiresAt) <= Date.now()
      )
        throw new EvidenceError('INVOCATION_EXPIRED');
      if (evidenceDigest(reply.modelIdentity) !== evidenceDigest(run.modelIdentity))
        throw new EvidenceError('MODEL_CONFIG_CHANGED');
      run.reply = reply;
      run.state = 'generated';
      await saveIn(tx, owner, run);
      return owner;
    });
  }
  async finalize(owner: string, runId: string): Promise<EvidenceRun> {
    return this.locked(owner, runId, async (tx, run) => {
      if (run.state !== 'generated') return run;
      if (!run.reply) throw new EvidenceError('MISSING_CAPTURED_REPLY', 500);
      const delivery = validateEvidenceOutput(run.reply, run.context);
      delivery.items = delivery.items.map((item) => ({
        ...item,
        itemId: `${run.id}:${item.index}`,
      }));
      run.delivery = delivery;
      run.state = delivery.state;
      await saveIn(tx, owner, run);
      return run;
    });
  }
  async interrupt(owner: string, runId: string): Promise<EvidenceRun> {
    return this.locked(owner, runId, async (tx, run) => {
      if (
        run.state === 'calling' &&
        run.leaseExpiresAt &&
        Date.parse(run.leaseExpiresAt) <= Date.now()
      ) {
        run.state = 'interrupted';
        run.errorCode = 'EXECUTION_UNKNOWN';
        await saveIn(tx, owner, run);
      }
      return run;
    });
  }
  async restrict(owner: string, runId: string, value: EvidenceRestriction): Promise<EvidenceRun> {
    return this.locked(owner, runId, async (tx, run) => {
      const existing = run.restrictions.find((x) => x.restrictionId === value.restrictionId);
      if (existing) {
        if (evidenceDigest(existing) !== evidenceDigest(value))
          throw new EvidenceError('RESTRICTION_CONFLICT');
        return run;
      }
      if (
        value.itemIds.some((id) => !run.delivery?.items.some((item) => item.itemId === id)) ||
        value.sourceRefs.some((ref) => !run.context.sourceIndex[ref])
      )
        throw new EvidenceError('INVALID_RESTRICTION', 400);
      run.restrictions.push(value);
      await saveIn(tx, owner, run);
      return run;
    });
  }
  async delete(owner: string, runId: string): Promise<void> {
    await this.provider.withTransaction(async (tx) => {
      await fenceOwnerWrite(tx, owner);
      const rows = await tx.query<{ stage_id: string } & Record<string, unknown>>(
        'SELECT stage_id FROM quiz_evidence_runs WHERE id=$1 AND owner_id=$2',
        [runId, owner],
      );
      if (!rows.rows[0]) return;
      await stageIn(tx, owner, rows.rows[0].stage_id);
      await tx.query(
        'UPDATE quiz_evidence_requests SET deleted_at=now(),run_id=NULL WHERE owner_id=$1 AND run_id=$2',
        [owner, runId],
      );
      await tx.query('DELETE FROM quiz_evidence_runs WHERE id=$1 AND owner_id=$2', [runId, owner]);
    });
  }
}
