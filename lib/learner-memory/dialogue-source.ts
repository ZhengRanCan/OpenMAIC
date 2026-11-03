import { digest, versionSource, invariant } from './contracts';
import type { DialogueEvidenceRun } from '@/lib/dialogue/evidence-contracts';
import { buildDialogueEvidenceContext } from '@/lib/dialogue/evidence-context';
import { validateDialogueEvidenceReply } from '@/lib/dialogue/evidence-validation';
import { dialogueContentDigest } from '@/lib/dialogue/trace-projection';
import type { DialogueMemorySourceRecord } from './dialogue-contracts';

export function adaptDialogueMemorySources(run: DialogueEvidenceRun): {
  key: string;
  source: DialogueMemorySourceRecord['source'];
  record: DialogueMemorySourceRecord;
}[] {
  invariant(['completed', 'empty'].includes(run.state), 'DIALOGUE_NOT_COMPLETED');
  invariant(run.snapshot && run.context && run.binding && run.reply, 'DIALOGUE_SOURCE_INCOMPLETE');
  const b = run.binding,
    snapshot = run.snapshot;
  invariant(
    run.ownerId === b.ownerId &&
      run.ownerId === snapshot.ownerId &&
      run.stageId === b.stageId &&
      run.stageId === snapshot.stageId &&
      run.chatSessionId === b.chatSessionId &&
      run.chatSessionId === snapshot.chatSessionId &&
      b.sourceDigest === snapshot.contentDigest,
    'DIALOGUE_BINDING_MISMATCH',
  );
  invariant(run.facts.length <= 16, 'MEMORY_BATCH_LIMIT');
  invariant(
    dialogueContentDigest(snapshot) === snapshot.contentDigest,
    'DIALOGUE_SNAPSHOT_DIGEST_MISMATCH',
  );
  const rebuilt = buildDialogueEvidenceContext(snapshot);
  invariant(
    digest(rebuilt.sourceIndex) === digest(run.context.sourceIndex),
    'DIALOGUE_REFERENCE_MAP_MISMATCH',
  );
  const checked = validateDialogueEvidenceReply(run.reply, rebuilt);
  invariant(
    checked.state === run.state &&
      digest(checked.facts) ===
        digest(run.facts.map(({ type, evidence, refs }) => ({ type, evidence, refs }))),
    'DIALOGUE_FACT_MISMATCH',
  );
  invariant(
    digest(rebuilt.messageVersions) === digest(run.context.messageVersions),
    'DIALOGUE_MESSAGE_VERSION_MISMATCH',
  );
  return run.facts.map((fact) => {
    invariant(fact.refs.length <= 32, 'MEMORY_SOURCE_REF_LIMIT');
    invariant(
      fact.refs.every((ref) => fact.messageVersions[ref] === rebuilt.messageVersions[ref]),
      'DIALOGUE_FACT_VERSION_MISMATCH',
    );
    const versions = Object.fromEntries(
      [...fact.refs].sort().map((ref) => [ref, rebuilt.messageVersions[ref]]),
    );
    const key = digest({
      owner: b.ownerId,
      stage: b.stageId,
      session: b.chatSessionId,
      student: b.student,
      environment: b.memoryEnvironmentId,
      nature: b.sourceNature,
      conditions: [...b.conditions].sort(),
      type: fact.type,
      text: fact.evidence,
      versions,
    });
    const messageTimes = snapshot.messages
      .filter((m) => fact.refs.includes(m.message.id) && m.message.role === 'user')
      .map((m) => m.message.metadata?.createdAt);
    const occurredAt =
      messageTimes.length &&
      messageTimes.every(
        (t) => typeof t === 'number' && Number.isFinite(t) && !Number.isNaN(new Date(t).getTime()),
      )
        ? new Date(Math.max(...(messageTimes as number[]))).toISOString()
        : null;
    const conditions = [
      ...new Set([
        ...b.conditions,
        'dialogue-evidence:synthesis',
        'not-personal-learner-evidence',
        JSON.stringify({
          factType: fact.type,
          window: snapshot.window,
          initialContextMissing: !snapshot.initialContext,
          messages: fact.refs.map((ref) => ({
            id: ref,
            role: rebuilt.sourceIndex[ref].role,
            version: versions[ref],
            interrupted:
              snapshot.messages.find((m) => m.message.id === ref)!.message.metadata?.interrupted ??
              null,
          })),
        }),
      ]),
    ];
    const source = versionSource({
      id: `sim:${b.student}:dialogue:${key}`,
      kind: 'dialogue_evidence',
      text: fact.evidence,
      refs: fact.refs.map(
        (ref) =>
          `postgres:dialogue_evidence_runs/${run.id}/snapshot/messages/${encodeURIComponent(ref)}@${versions[ref]}`,
      ),
      conditions,
      sourceNature: b.sourceNature,
      occurredAt,
      provenance: {
        file: `postgres:dialogue_evidence_runs/${run.id}`,
        sha256: digest({ snapshot, fact, binding: b }),
        pointer: `/facts/${run.facts.indexOf(fact)}`,
        bindings: fact.refs.map((ref) => `${ref}=${versions[ref]}`),
      },
    });
    return {
      key,
      source,
      record: {
        id: source.id,
        ownerId: b.ownerId,
        student: b.student,
        environmentId: b.memoryEnvironmentId,
        stageId: b.stageId,
        chatSessionId: b.chatSessionId,
        evidenceRunId: run.id,
        factId: fact.id,
        bindingDigest: digest(b),
        source,
      },
    };
  });
}
