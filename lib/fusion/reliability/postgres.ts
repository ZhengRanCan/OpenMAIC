/** Minimal PostgreSQL boundary; the host supplies a correctly scoped pool. */
export interface QueryResult<TRow extends Record<string, unknown> = Record<string, unknown>> {
  rows: TRow[];
}

export interface Queryable {
  query<TRow extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    params?: unknown[],
  ): Promise<QueryResult<TRow>>;
}

/**
 * Must check out a fresh connection, run BEGIN/body/COMMIT or ROLLBACK, and
 * release it. Reusing a shared client permits concurrent transactions to mix.
 */
export type WithTransaction = <T>(body: (queryable: Queryable) => Promise<T>) => Promise<T>;
