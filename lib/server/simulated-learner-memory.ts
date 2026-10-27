import { Pool } from 'pg';
import type { ConnectableQueryable } from '@openmaic/storage/server/reference';
import { simulatedScope } from '@/lib/learner-memory/simulated-seeds';
import { LearnerMemoryStore } from '@/lib/persistence/learner-memory-store';
import { readMemory } from '@/lib/server/learner-memory';
import {
  PreclassLearnerContextError,
  type SimulatedLearnerId,
} from '@/lib/learner-context/contracts';

export type LearnerMemoryRead = Awaited<ReturnType<typeof readMemory>>;
export type LearnerMemoryReader = (student: SimulatedLearnerId) => Promise<LearnerMemoryRead>;

export async function readSimulatedLearnerMemory(
  student: SimulatedLearnerId,
): Promise<LearnerMemoryRead> {
  if (!['A', 'B', 'C'].includes(student))
    throw new PreclassLearnerContextError('UNKNOWN_SIMULATED_STUDENT');
  const connectionString = process.env.MEMORY_DATABASE_URL?.trim();
  if (!connectionString) throw new PreclassLearnerContextError('LEARNER_MEMORY_UNAVAILABLE');
  const scope = simulatedScope(student);
  const pool = new Pool({
    connectionString,
    connectionTimeoutMillis: 5_000,
    query_timeout: 10_000,
    statement_timeout: 10_000,
    lock_timeout: 5_000,
    max: 1,
    options: '-c search_path=f67_simulated_memory',
  });
  let idleError: Error | undefined;
  pool.on('error', (error: Error) => {
    idleError = error;
  });
  try {
    const { nodePostgresTransaction } = await import('@openmaic/storage/server/reference');
    const withTransaction = nodePostgresTransaction(pool as unknown as ConnectableQueryable);
    const store = new LearnerMemoryStore({
      withTransaction: (body) =>
        withTransaction(async (tx) => {
          // The formal store normally creates an empty state when absent. Consumers
          // require initialized simulated identities, so hold the existing row
          // throughout the formal read and never turn missing setup into empty Memory.
          const existing = await tx.query(
            'SELECT learner_key FROM learner_memory_states WHERE namespace=$1 AND learner_key=$2 FOR UPDATE',
            [scope.namespace, scope.learnerKey],
          );
          if (!existing.rows.length)
            throw new PreclassLearnerContextError('LEARNER_MEMORY_UNAVAILABLE');
          return body(tx);
        }),
    });
    const result = await readMemory(store, scope);
    if (idleError) throw idleError;
    return result;
  } finally {
    await pool.end();
  }
}
