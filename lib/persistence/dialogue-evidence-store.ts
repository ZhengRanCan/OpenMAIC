import { randomUUID } from 'node:crypto';
import type { Queryable } from '@openmaic/storage/document/pg';
import type { ServerPersistenceProvider } from './server-provider';
import { fenceOwnerWrite } from './owner-merges';
import { restrictDialogueMemoryIn } from './dialogue-memory-lifecycle';
import { restrictDialogueLoopIn } from './dialogue-learning-loop-lifecycle';
import { readDialogueSourceIn } from './dialogue-trace-read';
import {
  dialogueEvidenceRunIn,
  dialogueSourceStatusIn,
  redactDialogueRun,
} from './dialogue-evidence-read';
import {
  buildDialogueEvidenceContext,
  dialogueCandidateFingerprint,
} from '@/lib/dialogue/evidence-context';
import {
  DIALOGUE_EVIDENCE_SYSTEM,
  DIALOGUE_EVIDENCE_SYSTEM_V1,
} from '@/lib/dialogue/evidence-prompt';
import { validateDialogueEvidenceReply } from '@/lib/dialogue/evidence-validation';
import { digest } from '@/lib/learner-memory/contracts';
import {
  resolveDialogueBindingIn,
  verifyDialogueBindingIn,
} from '@/lib/server/dialogue-evidence-provenance';
import {
  DIALOGUE_CONTEXT_VERSION,
  DIALOGUE_EVIDENCE_PROTOCOL,
  DIALOGUE_PROMPT_VERSION,
  LEGACY_DIALOGUE_PROMPT_VERSION,
  DIALOGUE_LIMITS,
  DialogueEvidenceError,
  type DialogueEvidenceRun,
  type DialogueEvidenceSettings,
  type DialogueModelIdentity,
  type PrepareDialogueRequest,
  type DialogueClaim,
  type DialogueCapturedReply,
  type DialogueRecovery,
} from '@/lib/dialogue/evidence-contracts';
import type { DialogueSourceWindow } from '@/lib/dialogue/trace-types';
import { dialogueContentDigest } from '@/lib/dialogue/trace-projection';

async function lockStage(tx: Queryable, owner: string, stage: string) {
  const rows = await tx.query(
    'SELECT stage_id FROM stage_meta WHERE stage_id=$1 AND owner_id=$2 AND deleted_at IS NULL FOR UPDATE',
    [stage, owner],
  );
  if (!rows.rows.length) throw new DialogueEvidenceError('SOURCE_MISSING', 404);
}
async function save(tx: Queryable, owner: string, run: DialogueEvidenceRun) {
  run.updatedAt = new Date().toISOString();
  await tx.query(
    'UPDATE dialogue_evidence_runs SET state=$3,data=$4::jsonb,updated_at=$5 WHERE id=$1 AND owner_id=$2',
    [run.id, owner, run.state, JSON.stringify(run), run.updatedAt],
  );
}
async function receipt(
  tx: Queryable,
  owner: string,
  op: string,
  intent: string,
): Promise<DialogueEvidenceRun | null> {
  const rows = await tx.query(
    'SELECT intent_digest,run_id,deleted_at FROM dialogue_evidence_requests WHERE owner_id=$1 AND operation_id=$2',
    [owner, op],
  );
  const row = rows.rows[0];
  if (!row) return null;
  if (row.intent_digest !== intent) throw new DialogueEvidenceError('OPERATION_CONFLICT');
  if (row.deleted_at || !row.run_id) throw new DialogueEvidenceError('EVIDENCE_DELETED', 410);
  return dialogueEvidenceRunIn(tx, owner, row.run_id as string);
}
async function recordReceipt(
  tx: Queryable,
  owner: string,
  operationId: string,
  intent: string,
  run: DialogueEvidenceRun,
) {
  await tx.query(
    'INSERT INTO dialogue_evidence_requests(owner_id,operation_id,intent_digest,stage_id,run_id) VALUES($1,$2,$3,$4,$5)',
    [owner, operationId, intent, run.stageId, run.id],
  );
}
async function insert(tx: Queryable, run: DialogueEvidenceRun) {
  await tx.query(
    'INSERT INTO dialogue_evidence_runs(id,owner_id,stage_id,chat_session_id,reuse_key,retry_of,state,data) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)',
    [
      run.id,
      run.ownerId,
      run.stageId,
      run.chatSessionId,
      run.reuseKey,
      run.retryOf,
      run.state,
      JSON.stringify(run),
    ],
  );
}
async function eligible(
  tx: Queryable,
  run: DialogueEvidenceRun,
  settings: DialogueEvidenceSettings,
) {
  if (!run.snapshot || !run.binding || run.snapshot.ownerId !== run.ownerId) return false;
  const binding = await resolveDialogueBindingIn(tx, run.snapshot, settings);
  return (
    !!binding &&
    digest(binding) === digest(run.binding) &&
    (await verifyDialogueBindingIn(tx, run.snapshot, binding))
  );
}

export class DialogueEvidenceStore {
  constructor(readonly provider: Pick<ServerPersistenceProvider, 'withTransaction'>) {}
  async prepare(
    owner: string,
    request: PrepareDialogueRequest,
    settings: DialogueEvidenceSettings,
    model: DialogueModelIdentity,
  ): Promise<DialogueEvidenceRun> {
    return this.prepareUsing(owner, request, settings, model);
  }
  async prepareSnapshot(
    owner: string,
    request: PrepareDialogueRequest,
    snapshot: DialogueSourceWindow,
    settings: DialogueEvidenceSettings,
    model: DialogueModelIdentity,
  ): Promise<DialogueEvidenceRun> {
    if (
      snapshot.ownerId !== owner ||
      snapshot.stageId !== request.stageId ||
      snapshot.chatSessionId !== request.chatSessionId ||
      snapshot.contentDigest !== dialogueContentDigest(snapshot)
    )
      throw new DialogueEvidenceError('SNAPSHOT_MISMATCH');
    return this.prepareUsing(owner, request, settings, model, snapshot);
  }
  private async prepareUsing(
    owner: string,
    request: PrepareDialogueRequest,
    settings: DialogueEvidenceSettings,
    model: DialogueModelIdentity,
    frozen?: DialogueSourceWindow,
  ): Promise<DialogueEvidenceRun> {
    return this.provider.withTransaction(async (tx) => {
      await fenceOwnerWrite(tx, owner);
      await lockStage(tx, owner, request.stageId);
      const intent = digest({
        action: 'prepare',
        stageId: request.stageId,
        chatSessionId: request.chatSessionId,
      });
      const prior = await receipt(tx, owner, request.operationId, intent);
      if (prior) return prior;
      const promptVersion = model.promptVersion;
      if (
        promptVersion !== DIALOGUE_PROMPT_VERSION &&
        promptVersion !== LEGACY_DIALOGUE_PROMPT_VERSION
      )
        throw new DialogueEvidenceError('UNSUPPORTED_PROMPT_VERSION');
      const system =
        promptVersion === LEGACY_DIALOGUE_PROMPT_VERSION
          ? DIALOGUE_EVIDENCE_SYSTEM_V1
          : DIALOGUE_EVIDENCE_SYSTEM;
      const read = await readDialogueSourceIn(tx, owner, request);
      const snapshot = read.status === 'available' ? (frozen ?? read.source) : null;
      const context = snapshot ? buildDialogueEvidenceContext(snapshot, system) : null;
      const binding = snapshot ? await resolveDialogueBindingIn(tx, snapshot, settings) : null;
      const verified =
        snapshot && binding && (await verifyDialogueBindingIn(tx, snapshot, binding));
      const reason = !snapshot
        ? 'source_' + read.status
        : !verified
          ? 'not_eligible'
          : context!.tooLarge
            ? 'input_too_large'
            : null;
      const reuseKey = digest({
        owner,
        stage: request.stageId,
        session: request.chatSessionId,
        content: snapshot?.contentDigest ?? read,
        prompt: promptVersion,
        environment: settings.memoryEnvironmentId,
        // Ineligible checks consume no paid opportunity: registering later can prepare this content.
        eligibility: reason === 'not_eligible' ? 'not_eligible' : 'eligible',
      });
      const revoked = await tx.query(
        'SELECT reuse_key FROM dialogue_evidence_revocations WHERE owner_id=$1 AND reuse_key=$2',
        [owner, reuseKey],
      );
      if (revoked.rows.length) throw new DialogueEvidenceError('EVIDENCE_DELETED', 410);
      const rows = await tx.query(
        'SELECT data FROM dialogue_evidence_runs WHERE owner_id=$1 AND reuse_key=$2 AND retry_of IS NULL',
        [owner, reuseKey],
      );
      let run: DialogueEvidenceRun;
      if (rows.rows.length) run = { ...(rows.rows[0].data as DialogueEvidenceRun), ownerId: owner };
      else {
        const now = new Date().toISOString();
        run = {
          id: randomUUID(),
          ownerId: owner,
          stageId: request.stageId,
          chatSessionId: request.chatSessionId,
          reuseKey,
          protocol: DIALOGUE_EVIDENCE_PROTOCOL,
          promptVersion,
          contextVersion: DIALOGUE_CONTEXT_VERSION,
          state: reason ? 'blocked' : 'prepared',
          reason,
          createdAt: now,
          updatedAt: now,
          snapshot,
          context,
          system,
          binding: verified ? binding : null,
          model,
          reply: null,
          facts: [],
          diagnostics: [],
          token: null,
          leaseExpiresAt: null,
          retryOf: null,
        };
        await insert(tx, run);
      }
      await recordReceipt(tx, owner, request.operationId, intent, run);
      return run;
    });
  }
  private async locked<T>(
    owner: string,
    id: string,
    body: (tx: Queryable, run: DialogueEvidenceRun) => Promise<T>,
  ): Promise<T> {
    return this.provider.withTransaction(async (tx) => {
      await fenceOwnerWrite(tx, owner);
      const found = await dialogueEvidenceRunIn(tx, owner, id);
      await lockStage(tx, owner, found.stageId);
      return body(tx, await dialogueEvidenceRunIn(tx, owner, id, true));
    });
  }
  private async validateSource(
    tx: Queryable,
    owner: string,
    run: DialogueEvidenceRun,
  ): Promise<boolean> {
    const live = await dialogueSourceStatusIn(tx, owner, run);
    if (live.status === 'available') return true;
    run.state = live.status === 'missing' || live.status === 'deleted' ? 'revoked' : 'blocked';
    run.reason = 'source_' + live.status;
    run.token = null;
    await save(tx, owner, run);
    return false;
  }
  async claim(
    owner: string,
    id: string,
    settings: DialogueEvidenceSettings,
  ): Promise<DialogueClaim | null> {
    return this.locked(owner, id, async (tx, run) => {
      if (!(await this.validateSource(tx, owner, run))) return null;
      if (run.state === 'calling' && Date.parse(run.leaseExpiresAt ?? '') <= Date.now()) {
        run.state = 'unknown';
        run.reason = 'EXECUTION_UNKNOWN';
        await save(tx, owner, run);
      }
      if (run.state !== 'prepared') return null;
      if (!(await eligible(tx, run, settings))) {
        run.state = 'blocked';
        run.reason = 'not_eligible';
        await save(tx, owner, run);
        return null;
      }
      run.state = 'calling';
      run.token = randomUUID();
      run.leaseExpiresAt = new Date(Date.now() + DIALOGUE_LIMITS.leaseMs).toISOString();
      await save(tx, owner, run);
      return { runId: id, token: run.token };
    });
  }
  async capture(
    owner: string,
    claim: DialogueClaim,
    reply: DialogueCapturedReply,
    settings: DialogueEvidenceSettings,
  ) {
    const result = await this.locked(owner, claim.runId, async (tx, run) => {
      if (!(await this.validateSource(tx, owner, run))) return 'SOURCE_REVOKED';
      if (run.token === claim.token && run.reply && digest(run.reply) === digest(reply))
        return null;
      if (
        run.state !== 'calling' ||
        run.token !== claim.token ||
        Date.parse(run.leaseExpiresAt ?? '') <= Date.now()
      )
        return 'INVOCATION_EXPIRED';
      if (!(await eligible(tx, run, settings))) {
        run.state = 'blocked';
        run.reason = 'not_eligible';
        // Retain the received bytes even when a binding was withdrawn in flight.
        // Recovery can finalize these bytes after revalidation, without another call.
        run.reply = reply;
        await save(tx, owner, run);
        return 'NOT_ELIGIBLE';
      }
      run.reply = reply;
      run.state = 'captured';
      await save(tx, owner, run);
      return null;
    });
    if (result) throw new DialogueEvidenceError(result);
  }
  async finalize(owner: string, id: string): Promise<DialogueEvidenceRun> {
    return this.locked(owner, id, async (tx, run) => {
      if (!(await this.validateSource(tx, owner, run))) return redactDialogueRun(run, run.reason!);
      if (run.state !== 'captured') return run;
      if (!run.reply || !run.context)
        throw new DialogueEvidenceError('MISSING_CAPTURED_REPLY', 500);
      const checked = validateDialogueEvidenceReply(run.reply, run.context);
      run.state = checked.state;
      run.diagnostics = checked.diagnostics;
      run.reason = checked.diagnostics[0] ?? null;
      run.facts = checked.facts.map((fact, i) => ({
        ...fact,
        id: `${run.id}:${i}`,
        snapshotId: run.id,
        fingerprint: dialogueCandidateFingerprint(fact, run.context!),
        messageVersions: Object.fromEntries(
          fact.refs.map((ref) => [ref, run.context!.messageVersions[ref]]),
        ),
      }));
      await save(tx, owner, run);
      return run;
    });
  }
  async recover(
    owner: string,
    id: string,
    recovery: DialogueRecovery,
    settings: DialogueEvidenceSettings,
  ): Promise<DialogueEvidenceRun> {
    if (recovery.action === 'resume_prepared' || recovery.action === 'finalize_saved_reply') {
      const run = await this.locked(owner, id, async (tx, run) => {
        if (!(await this.validateSource(tx, owner, run)))
          throw new DialogueEvidenceError('SOURCE_REVOKED');
        if (!(await eligible(tx, run, settings))) throw new DialogueEvidenceError('NOT_ELIGIBLE');
        if (recovery.action === 'resume_prepared') {
          if (run.state === 'prepared') return run;
          if (
            run.state !== 'blocked' ||
            run.reply ||
            run.leaseExpiresAt ||
            !run.context ||
            run.context.tooLarge
          )
            throw new DialogueEvidenceError('RESUME_NOT_ALLOWED');
          run.state = 'prepared';
          run.reason = null;
          await save(tx, owner, run);
          return run;
        }
        if (run.state === 'blocked' && run.reply) {
          run.state = 'captured';
          run.reason = null;
          await save(tx, owner, run);
        }
        return run;
      });
      return recovery.action === 'finalize_saved_reply' && run.state === 'captured'
        ? this.finalize(owner, id)
        : run;
    }
    if (recovery.acknowledgeUnknownCost !== true)
      throw new DialogueEvidenceError('CONFIRMATION_REQUIRED', 400);
    return this.locked(owner, id, async (tx, run) => {
      const intent = digest({ action: recovery.action, id });
      const prior = await receipt(tx, owner, recovery.operationId, intent);
      if (prior) return prior;
      if (!(await this.validateSource(tx, owner, run)))
        throw new DialogueEvidenceError('SOURCE_REVOKED');
      if (run.state === 'calling' && Date.parse(run.leaseExpiresAt ?? '') <= Date.now()) {
        run.state = 'unknown';
        run.reason = 'EXECUTION_UNKNOWN';
      }
      if (!['unknown', 'invalid', 'truncated'].includes(run.state))
        throw new DialogueEvidenceError('RETRY_NOT_ALLOWED');
      if (!(await eligible(tx, run, settings))) throw new DialogueEvidenceError('NOT_ELIGIBLE');
      const revoked = await tx.query(
        'SELECT reuse_key FROM dialogue_evidence_revocations WHERE owner_id=$1 AND reuse_key=$2',
        [owner, run.reuseKey],
      );
      if (revoked.rows.length) throw new DialogueEvidenceError('EVIDENCE_DELETED', 410);
      const existing = await tx.query(
        'SELECT data FROM dialogue_evidence_runs WHERE owner_id=$1 AND retry_of=$2',
        [owner, id],
      );
      let next: DialogueEvidenceRun;
      if (existing.rows.length) next = existing.rows[0].data as DialogueEvidenceRun;
      else {
        run.token = null;
        await save(tx, owner, run);
        const now = new Date().toISOString();
        next = {
          ...run,
          id: randomUUID(),
          state: 'prepared',
          reason: null,
          createdAt: now,
          updatedAt: now,
          retryOf: id,
          reply: null,
          facts: [],
          diagnostics: [],
          token: null,
          leaseExpiresAt: null,
        };
        await insert(tx, next);
      }
      await recordReceipt(tx, owner, recovery.operationId, intent, next);
      return next;
    });
  }
  async delete(owner: string, id: string) {
    return this.locked(owner, id, async (tx, run) => {
      await tx.query(
        'INSERT INTO dialogue_evidence_revocations(owner_id,stage_id,reuse_key) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
        [owner, run.stageId, run.reuseKey],
      );
      const rows = await tx.query(
        'SELECT data FROM dialogue_evidence_runs WHERE owner_id=$1 AND reuse_key=$2',
        [owner, run.reuseKey],
      );
      for (const row of rows.rows) {
        await restrictDialogueLoopIn(tx, owner, {
          evidenceRunId: (row.data as DialogueEvidenceRun).id,
        });
        await restrictDialogueMemoryIn(tx, owner, {
          evidenceRunId: (row.data as DialogueEvidenceRun).id,
        });
        const revoked = redactDialogueRun(row.data as DialogueEvidenceRun, 'evidence_deleted');
        await save(tx, owner, revoked);
      }
      await tx.query(
        'UPDATE dialogue_evidence_requests SET deleted_at=now() WHERE owner_id=$1 AND run_id IN(SELECT id FROM dialogue_evidence_runs WHERE owner_id=$1 AND reuse_key=$2)',
        [owner, run.reuseKey],
      );
    });
  }
}
