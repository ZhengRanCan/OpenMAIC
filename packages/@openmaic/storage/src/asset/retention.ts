import type { Queryable } from '../runtime/pg.js';
import { isLosslessJsonString } from '../runtime/json-value.js';
import type { AssetId } from './id.js';
import type { ContentHash } from './blob.js';

/** A server-owned durable consumer; never accepted from a public asset request. */
export interface AssetRetentionHolder {
  readonly kind: string;
  readonly id: string;
}

export interface CloneRetainedAssetsInput {
  /** Server-authorized source partitions, including explicitly allowed legacy partitions. */
  readonly sourcePrincipals: readonly string[];
  readonly sourceIds: readonly string[];
  readonly holder: AssetRetentionHolder;
  /** Optional background only: omit absent, unauthorized or missing-byte sources. */
  readonly skipUnavailable?: boolean;
}

/** A new immutable entry naming the same physical bytes as a captured source. */
export interface RetainedAsset {
  readonly sourceId: string;
  readonly assetId: AssetId;
  readonly contentHash: ContentHash;
  readonly sourceRevision: number;
  readonly mime: string;
  readonly byteSize: number;
}

export class AssetRetainedError extends Error {
  readonly code = 'ASSET_RETAINED' as const;

  constructor() {
    super('@openmaic/storage: asset is held by a historical content version');
    this.name = 'AssetRetainedError';
  }
}

/** Additive migration: the shipped v1 statements remain unchanged. */
export const ASSET_RETENTION_PG_SCHEMA: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS asset_retention_refs (
     holder_kind TEXT NOT NULL,
     holder_id TEXT NOT NULL,
     asset_id TEXT NOT NULL REFERENCES asset_entries(id) ON DELETE RESTRICT,
     PRIMARY KEY (holder_kind, holder_id, asset_id)
   )`,
  `CREATE INDEX IF NOT EXISTS asset_retention_refs_asset_idx
     ON asset_retention_refs (asset_id)`,
];

/** Transaction-pinned server lifecycle hook. Does not open or commit a transaction. */
export async function releaseRetentionIn(
  queryable: Queryable,
  holder: AssetRetentionHolder,
): Promise<void> {
  await releaseRetentionsIn(queryable, [holder]);
}

/** Release a whole host transaction's holders with ONE ordered union of entry locks. */
export async function releaseRetentionsIn(
  queryable: Queryable,
  holders: readonly AssetRetentionHolder[],
): Promise<void> {
  const unique = new Map<string, AssetRetentionHolder>();
  for (const holder of holders) {
    if (
      !holder ||
      typeof holder.kind !== 'string' ||
      !holder.kind ||
      typeof holder.id !== 'string' ||
      !holder.id ||
      !isLosslessJsonString(holder.kind) ||
      !isLosslessJsonString(holder.id)
    ) {
      throw new Error('@openmaic/storage: retention holder must have non-empty text kind and id');
    }
    unique.set(JSON.stringify(['asset-retention', holder.kind, holder.id]), holder);
  }
  if (unique.size === 0) return;
  const keys = await queryable.query<{ key: string }>(
    'SELECT DISTINCT hashtextextended(holder, 0)::text AS key FROM unnest($1::text[]) AS holder',
    [[...unique.keys()]],
  );
  const ordered = keys.rows
    .map((row) => BigInt(row.key))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  for (const key of ordered)
    await queryable.query('SELECT pg_advisory_xact_lock($1::bigint)', [key.toString()]);
  const kinds = [...unique.values()].map((holder) => holder.kind);
  const ids = [...unique.values()].map((holder) => holder.id);
  const entries = await queryable.query<{ id: string }>(
    `SELECT entries.id FROM asset_entries AS entries
      WHERE EXISTS (SELECT 1 FROM asset_retention_refs AS refs
                     WHERE refs.asset_id = entries.id
                       AND (refs.holder_kind, refs.holder_id) IN (SELECT * FROM unnest($1::text[], $2::text[])))
      ORDER BY entries.id ASC FOR UPDATE`,
    [kinds, ids],
  );
  await queryable.query(
    'DELETE FROM asset_retention_refs WHERE (holder_kind, holder_id) IN (SELECT * FROM unnest($1::text[], $2::text[]))',
    [kinds, ids],
  );
  await queryable.query(
    `UPDATE asset_entries AS entries SET unreferenced_at = now()
      WHERE entries.id = ANY($1::text[]) AND entries.unreferenced_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM document_asset_refs AS refs WHERE refs.asset_id = entries.id)
        AND NOT EXISTS (SELECT 1 FROM asset_retention_refs AS refs WHERE refs.asset_id = entries.id)`,
    [entries.rows.map((row) => row.id)],
  );
}
