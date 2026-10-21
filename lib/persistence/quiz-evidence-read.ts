import type { Queryable } from '@openmaic/storage/document/pg';
import type { ServerPersistenceProvider } from './server-provider';
import { readPreparedIn } from './quiz-trace';
import { EvidenceError, type EvidenceRun, type EvidenceRunView } from '@/lib/evidence/contracts';
import {
  evidenceDigest,
  provenanceFingerprint,
  validatePreparedSource,
} from '@/lib/evidence/context';

export async function evidenceRunIn(
  tx: Queryable,
  owner: string,
  runId: string,
  lock = false,
): Promise<EvidenceRun> {
  const found = await tx.query<
    {
      data: EvidenceRun;
      state: EvidenceRun['state'];
      invocation_token: string | null;
      lease_expires_at: Date | string | null;
    } & Record<string, unknown>
  >(
    `SELECT r.data,r.state,r.invocation_token,r.lease_expires_at FROM quiz_evidence_runs r JOIN stage_meta s ON s.stage_id=r.stage_id WHERE r.id=$1 AND r.owner_id=$2 AND s.owner_id=$2 AND s.deleted_at IS NULL${lock ? ' FOR UPDATE OF r' : ''}`,
    [runId, owner],
  );
  const row = found.rows[0];
  if (!row) throw new EvidenceError('EVIDENCE_NOT_FOUND', 404);
  return {
    ...row.data,
    state: row.state,
    ...(row.invocation_token ? { invocationToken: row.invocation_token } : {}),
    ...(row.lease_expires_at
      ? { leaseExpiresAt: new Date(row.lease_expires_at).toISOString() }
      : {}),
  };
}

export async function inspectEvidenceSourcesIn(
  tx: Queryable,
  owner: string,
  run: EvidenceRun,
): Promise<{
  unavailable?: 'source-unavailable' | 'source-check-unavailable';
  sourceChanges: Extract<EvidenceRunView, { visibility: 'visible' }>['sourceChanges'];
}> {
  const sourceChanges: Extract<EvidenceRunView, { visibility: 'visible' }>['sourceChanges'] = [];
  for (const old of [run.sourceEnvelope.anchor, ...run.sourceEnvelope.related]) {
    let current;
    try {
      current = await readPreparedIn(tx, owner, old.attemptId);
    } catch (error) {
      return {
        unavailable:
          error instanceof Error &&
          'code' in error &&
          ['ATTEMPT_NOT_FOUND', 'VERSION_NOT_FOUND'].includes(String(error.code))
            ? 'source-unavailable'
            : 'source-check-unavailable',
        sourceChanges: [],
      };
    }
    if (!current.submission || current.submission.id !== old.submission?.id)
      return { unavailable: 'source-unavailable', sourceChanges: [] };
    try {
      validatePreparedSource(current);
    } catch {
      return { unavailable: 'source-check-unavailable', sourceChanges: [] };
    }
    const add = (code: string, reviewId?: string) => {
      const refs = Object.values(run.context.sourceIndex)
        .filter(
          (card) =>
            card.scope.versionId === old.version.id &&
            (!card.scope.attemptId || card.scope.attemptId === old.attemptId) &&
            (!reviewId || card.scope.reviewId === reviewId),
        )
        .map((card) => card.ref);
      const itemIds = run.delivery?.items
        .filter((item) => item.citations.some((c) => refs.includes(c.ref)))
        .flatMap((item) => (item.itemId ? [item.itemId] : []));
      sourceChanges.push({ code, sourceRefs: refs, itemIds: itemIds ?? [] });
    };
    if (provenanceFingerprint(current) !== provenanceFingerprint(old))
      add('SOURCE_CONTENT_CHANGED');
    for (const review of old.reviews) {
      const now = current.reviews.find((x) => x.id === review.id);
      if (!now || evidenceDigest(now) !== evidenceDigest(review))
        add('ADOPTED_REVIEW_CHANGED', review.id);
    }
    if (
      current.reviews.some((review) => !old.reviews.some((x) => x.id === review.id)) ||
      current.review?.id !== old.review?.id ||
      current.previousUsableReview?.id !== old.previousUsableReview?.id ||
      evidenceDigest(current.pendingReview ?? null) !== evidenceDigest(old.pendingReview ?? null)
    )
      add('AVAILABLE_NOT_INCLUDED');
  }
  return { sourceChanges };
}

export async function projectEvidenceRunIn(
  tx: Queryable,
  owner: string,
  run: EvidenceRun,
): Promise<EvidenceRunView> {
  const checked = await inspectEvidenceSourcesIn(tx, owner, run);
  if (checked.unavailable)
    return {
      runId: run.id,
      state: run.state,
      visibility: checked.unavailable,
      reasonCode:
        checked.unavailable === 'source-unavailable'
          ? 'SOURCE_UNAVAILABLE'
          : 'SOURCE_CHECK_UNAVAILABLE',
      semanticStatus: 'unreviewed',
      adoptionAllowed: false,
    };
  // Invocation tokens are server execution capabilities, never public response fields.
  const { invocationToken: _token, ...publicRun } = run;
  return {
    ...publicRun,
    visibility: 'visible',
    effectiveState:
      run.state === 'calling' && run.leaseExpiresAt && Date.parse(run.leaseExpiresAt) <= Date.now()
        ? 'interrupted'
        : run.state,
    sourceChanges: checked.sourceChanges,
    semanticStatus: 'unreviewed',
    adoptionAllowed: false,
  };
}

export async function readEvidenceRun(
  provider: ServerPersistenceProvider,
  owner: string,
  runId: string,
): Promise<EvidenceRunView> {
  return provider.withTransaction(async (tx) => {
    await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
    return projectEvidenceRunIn(tx, owner, await evidenceRunIn(tx, owner, runId));
  });
}
export async function readEvidenceOperation(
  provider: ServerPersistenceProvider,
  owner: string,
  operationId: string,
): Promise<EvidenceRunView> {
  return provider.withTransaction(async (tx) => {
    await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
    const found = await tx.query<
      { run_id: string | null; deleted_at: string | null } & Record<string, unknown>
    >(
      'SELECT q.run_id,q.deleted_at FROM quiz_evidence_requests q JOIN stage_meta s ON s.stage_id=q.stage_id WHERE q.owner_id=$1 AND q.operation_id=$2 AND s.owner_id=$1 AND s.deleted_at IS NULL',
      [owner, operationId],
    );
    if (!found.rows[0]) throw new EvidenceError('EVIDENCE_NOT_FOUND', 404);
    if (found.rows[0].deleted_at || !found.rows[0].run_id)
      throw new EvidenceError('EVIDENCE_DELETED', 410);
    return projectEvidenceRunIn(tx, owner, await evidenceRunIn(tx, owner, found.rows[0].run_id));
  });
}
