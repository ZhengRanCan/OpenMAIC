import { DocumentWriteRefusedError, type RuntimeStore } from '@openmaic/storage';
import type { Queryable } from '@openmaic/storage/document/pg';

/** Generic Runtime HTTP cannot mutate or delete a bound Quiz. Dedicated Quiz lifecycle owns it. */
export function guardQuizRuntime(inner: RuntimeStore, tx: Queryable): RuntimeStore {
  async function refuse(where: string, values: unknown[]) {
    const table = await tx.query<{ present: boolean } & Record<string, unknown>>(
      "SELECT to_regclass('quiz_trace_attempts') IS NOT NULL AS present",
    );
    if (!table.rows[0]?.present) return;
    const r = await tx.query(`SELECT id FROM quiz_trace_attempts WHERE ${where} LIMIT 1`, values);
    if (r.rows.length)
      throw new DocumentWriteRefusedError(
        '',
        'QUIZ_TRACE_MANAGED',
        'Use the Quiz trace API for this attempt',
      );
  }
  return {
    ...inner,
    createSession: (init) => inner.createSession(init),
    getSession: (id) => inner.getSession(id),
    listSessions: (s, l) => inner.listSessions(s, l),
    listRecords: (id, o) => inner.listRecords(id, o),
    async appendRecord(init, options) {
      await refuse('id=$1', [init.sessionId]);
      return inner.appendRecord(init, options);
    },
    async setSessionStatus(id, s, t, o) {
      await refuse('id=$1', [id]);
      return inner.setSessionStatus(id, s, t, o);
    },
    async deleteSession(id) {
      await refuse('id=$1', [id]);
      return inner.deleteSession(id);
    },
    async deleteLearnerRuntime(s, l) {
      await refuse('stage_id=$1 AND owner_id=$2', [s, l]);
      return inner.deleteLearnerRuntime(s, l);
    },
    async deleteStageRuntime(s) {
      await refuse('stage_id=$1', [s]);
      return inner.deleteStageRuntime(s);
    },
    async deleteAllRuntime() {
      await refuse('TRUE', []);
      return inner.deleteAllRuntime();
    },
    mergeLearner: (f, t) => inner.mergeLearner(f, t),
  };
}
