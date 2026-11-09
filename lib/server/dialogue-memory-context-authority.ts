import { shortFactSources } from '@/lib/evidence/short-facts';
import { digest, type MemorySource } from '@/lib/learner-memory/contracts';
import { simulatedSeed, type SimulatedStudent } from '@/lib/learner-memory/simulated-seeds';
import { getServerPersistenceProvider } from '@/lib/persistence/server-provider';
import { QuizShortFactsService } from './quiz-short-facts';

/** Local eligibility only. Never revoke sources in the shared simulated store. */
export async function authorizeDialogueMemorySupports(
  owner: string,
  student: SimulatedStudent,
  environment: string,
  sources: readonly MemorySource[],
): Promise<Set<string>> {
  const seed = new Set(simulatedSeed(student).sources.map(digest));
  const allowed = new Set<string>();
  const dialogueIds = new Set<string>();
  const quizIds = new Set<string>();
  for (const source of sources) {
    if (source.sourceNature !== 'synthetic') continue;
    const key = digest(source);
    if (seed.has(key)) allowed.add(key);
    else if (source.kind === 'dialogue_evidence') dialogueIds.add(source.id);
    else if (source.kind === 'quiz_evidence') {
      const match = /^postgres:f68_short_facts_runs\/([\w-]{1,80})\/snapshot$/.exec(
        source.provenance.file,
      );
      if (match) quizIds.add(match[1]!);
    }
  }
  if (!dialogueIds.size && !quizIds.size) return allowed;

  const app = await getServerPersistenceProvider(process.env.DATABASE_URL ?? '');
  if (dialogueIds.size) {
    const { rows } = await app.pool.query<{ source: MemorySource }>(
      `SELECT data->'source' AS source FROM dialogue_memory_sources
       WHERE owner_id=$1 AND student=$2 AND environment_id=$3 AND NOT revoked
         AND id=ANY($4::text[]) AND data->'source'->>'sourceNature'='synthetic'`,
      [owner, student, environment, [...dialogueIds]],
    );
    for (const { source } of rows) allowed.add(digest(source));
  }

  const quiz = new QuizShortFactsService(app.withTransaction);
  for (const runId of quizIds) {
    try {
      const run = await quiz.read(owner, runId);
      if (
        run.state !== 'completed' ||
        !run.snapshot ||
        !run.reply ||
        run.request.student !== student ||
        run.request.sourceNature !== 'synthetic' ||
        run.request.memoryEnvironmentId !== environment
      )
        continue;
      const { sources: proven } = shortFactSources({
        student,
        runId,
        snapshotFile: `postgres:f68_short_facts_runs/${run.id}/snapshot`,
        snapshotBytes: Buffer.from(run.snapshot),
        reply: run.reply.text,
        refs: run.context.refs,
        sourceNature: 'synthetic',
        occurredAt: run.context.source.savedAt,
      });
      for (const source of proven) allowed.add(digest(source));
    } catch {
      // An unavailable, changed or foreign Quiz does not authorize its source.
    }
  }
  return allowed;
}
