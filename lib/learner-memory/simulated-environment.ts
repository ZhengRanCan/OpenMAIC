import type { Queryable, WithTransaction } from '@openmaic/storage/document/pg';
import { assertSource, DEFAULT_BUDGETS, invariant, type MemorySource } from './contracts';
import {
  simulatedScope,
  simulatedSeed,
  SIMULATED_STUDENTS,
  type SimulatedStudent,
} from './simulated-seeds';
import { SIMULATED_MEMORY_SYSTEM } from './simulated-prompt';
import { LearnerMemoryStore } from '@/lib/persistence/learner-memory-store';
import { readMemory, updateMemory, type MemoryInvoker } from '@/lib/server/learner-memory';

/** Local simulation adapter. All writes remain in the same Memory tables and transactions. */
export class SimulatedMemoryEnvironment {
  readonly store: LearnerMemoryStore;
  constructor(readonly provider: { withTransaction: WithTransaction }) {
    this.store = new LearnerMemoryStore({ ...provider, systemPrompt: SIMULATED_MEMORY_SYSTEM });
  }
  private async seedOne(tx: Queryable, student: SimulatedStudent, reset: boolean) {
    const seed = simulatedSeed(student),
      keys = [seed.scope.namespace, seed.scope.learnerKey];
    const inserted = await tx.query(
      'INSERT INTO learner_memory_states(namespace,learner_key,snapshot) VALUES($1,$2,$3::jsonb) ON CONFLICT DO NOTHING RETURNING learner_key',
      [...keys, JSON.stringify(seed.snapshot)],
    );
    await tx.query(
      'SELECT snapshot FROM learner_memory_states WHERE namespace=$1 AND learner_key=$2 FOR UPDATE',
      keys,
    );
    if (!inserted.rows.length && !reset) return { student, state: 'retained' as const };
    const active = await tx.query(
      "SELECT id FROM learner_memory_runs WHERE namespace=$1 AND learner_key=$2 AND state IN ('prepared','calling','captured')",
      keys,
    );
    invariant(!active.rows.length, 'SIMULATED_MEMORY_BUSY');
    await tx.query('DELETE FROM learner_memory_runs WHERE namespace=$1 AND learner_key=$2', keys);
    await tx.query(
      'DELETE FROM learner_memory_sources WHERE namespace=$1 AND learner_key=$2',
      keys,
    );
    for (const source of seed.sources)
      await tx.query(
        'INSERT INTO learner_memory_sources(namespace,learner_key,source_id,version,data,processed) VALUES($1,$2,$3,$4,$5::jsonb,true)',
        [...keys, source.id, source.version, JSON.stringify(source)],
      );
    await tx.query(
      'UPDATE learner_memory_states SET snapshot=$3::jsonb,maintenance=false WHERE namespace=$1 AND learner_key=$2',
      [...keys, JSON.stringify(seed.snapshot)],
    );
    return { student, state: reset ? ('reset' as const) : ('created' as const) };
  }
  async initialize(student?: SimulatedStudent) {
    const students = student === undefined ? [...SIMULATED_STUDENTS] : [student];
    students.forEach(simulatedScope);
    return this.provider.withTransaction(async (tx) => {
      const results = [];
      for (const id of students) results.push(await this.seedOne(tx, id, false));
      return results;
    });
  }
  async reset(student?: SimulatedStudent) {
    const students = student === undefined ? [...SIMULATED_STUDENTS] : [student];
    students.forEach(simulatedScope);
    return this.provider.withTransaction(async (tx) => {
      const results = [];
      for (const id of students) results.push(await this.seedOne(tx, id, true));
      return results;
    });
  }
  private async requireInitialized(student: SimulatedStudent) {
    const scope = simulatedScope(student);
    await this.provider.withTransaction(async (tx) => {
      const found = await tx.query(
        'SELECT learner_key FROM learner_memory_states WHERE namespace=$1 AND learner_key=$2',
        [scope.namespace, scope.learnerKey],
      );
      invariant(found.rows.length === 1, 'SIMULATED_MEMORY_NOT_INITIALIZED');
    });
    return scope;
  }
  async read(student: SimulatedStudent) {
    return readMemory(this.store, await this.requireInitialized(student));
  }
  async ingest(student: SimulatedStudent, sources: MemorySource[]) {
    const scope = await this.requireInitialized(student);
    const values = sources.map(assertSource);
    invariant(
      values.every((s) => s.id.startsWith(`sim:${student}:`)),
      'SIMULATED_SOURCE_STUDENT_MISMATCH',
    );
    await this.store.ingest(scope, values);
  }
  async update(student: SimulatedStudent, operationId: string, invoke: MemoryInvoker) {
    const scope = await this.requireInitialized(student);
    const run = await this.store.prepare(scope, operationId, DEFAULT_BUDGETS);
    const result =
      run.state === 'noop' ? run : await updateMemory(this.store, scope, run.id, invoke);
    return { run: result, memory: await readMemory(this.store, scope) };
  }
}
