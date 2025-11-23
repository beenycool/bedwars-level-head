import { pool } from './cache';

interface PlayerQueryHistoryRow {
  id: string;
  identifier: string;
  normalized_identifier: string;
  lookup_type: 'uuid' | 'ign';
  resolved_uuid: string | null;
  resolved_username: string | null;
  stars: number | null;
  nicked: boolean;
  cache_source: string;
  cache_hit: boolean;
  revalidated: boolean;
  install_id: string | null;
  response_status: number;
  requested_at: Date;
}

export interface PlayerQueryRecord {
  identifier: string;
  normalizedIdentifier: string;
  lookupType: 'uuid' | 'ign';
  resolvedUuid: string | null;
  resolvedUsername: string | null;
  stars: number | null;
  nicked: boolean;
  cacheSource: 'cache' | 'network';
  cacheHit: boolean;
  revalidated: boolean;
  installId: string | null;
  responseStatus: number;
}

export interface PlayerQuerySummary {
  identifier: string;
  normalizedIdentifier: string;
  lookupType: 'uuid' | 'ign';
  resolvedUuid: string | null;
  resolvedUsername: string | null;
  stars: number | null;
  nicked: boolean;
  cacheSource: 'cache' | 'network';
  cacheHit: boolean;
  revalidated: boolean;
  installId: string | null;
  responseStatus: number;
  requestedAt: Date;
}

const initialization = (async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS player_query_history (
        id BIGSERIAL PRIMARY KEY,
        identifier TEXT NOT NULL,
        normalized_identifier TEXT NOT NULL,
        lookup_type TEXT NOT NULL,
        resolved_uuid TEXT,
        resolved_username TEXT,
        stars INTEGER,
        nicked BOOLEAN NOT NULL DEFAULT FALSE,
        cache_source TEXT NOT NULL,
        cache_hit BOOLEAN NOT NULL DEFAULT FALSE,
        revalidated BOOLEAN NOT NULL DEFAULT FALSE,
        install_id TEXT,
        response_status INTEGER NOT NULL,
        requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_player_query_history_requested_at
      ON player_query_history (requested_at DESC)
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_player_query_history_identifier
      ON player_query_history (normalized_identifier)
    `);
  } catch (error) {
    console.error('Failed to initialize player_query_history table', error);
    throw error;
  }
})();

async function ensureInitialized(): Promise<void> {
  await initialization;
}

export async function recordPlayerQuery(record: PlayerQueryRecord): Promise<void> {
  await ensureInitialized();
  await pool.query(
    `
      INSERT INTO player_query_history (
        identifier,
        normalized_identifier,
        lookup_type,
        resolved_uuid,
        resolved_username,
        stars,
        nicked,
        cache_source,
        cache_hit,
        revalidated,
        install_id,
        response_status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    `,
    [
      record.identifier,
      record.normalizedIdentifier,
      record.lookupType,
      record.resolvedUuid,
      record.resolvedUsername,
      record.stars,
      record.nicked,
      record.cacheSource,
      record.cacheHit,
      record.revalidated,
      record.installId,
      record.responseStatus,
    ],
  );

  console.info(
    '[history] recorded query',
    {
      identifier: record.identifier,
      normalizedIdentifier: record.normalizedIdentifier,
      lookupType: record.lookupType,
      resolvedUuid: record.resolvedUuid,
      resolvedUsername: record.resolvedUsername,
      stars: record.stars,
      nicked: record.nicked,
      cacheSource: record.cacheSource,
      cacheHit: record.cacheHit,
      revalidated: record.revalidated,
      installId: record.installId,
      responseStatus: record.responseStatus,
    },
  );
}

export async function getRecentPlayerQueries(limit = 50): Promise<PlayerQuerySummary[]> {
  await ensureInitialized();
  const result = await pool.query<PlayerQueryHistoryRow>(
    `
      SELECT
        identifier,
        normalized_identifier,
        lookup_type,
        resolved_uuid,
        resolved_username,
        stars,
        nicked,
        cache_source,
        cache_hit,
        revalidated,
        install_id,
        response_status,
        requested_at
      FROM player_query_history
      ORDER BY requested_at DESC
      LIMIT $1
    `,
    [limit],
  );

  return result.rows.map((row) => ({
    identifier: row.identifier,
    normalizedIdentifier: row.normalized_identifier,
    lookupType: row.lookup_type,
    resolvedUuid: row.resolved_uuid,
    resolvedUsername: row.resolved_username,
    stars: row.stars,
    nicked: row.nicked,
    cacheSource: row.cache_source as 'cache' | 'network',
    cacheHit: row.cache_hit,
    revalidated: row.revalidated,
    installId: row.install_id,
    responseStatus: row.response_status,
    requestedAt: new Date(row.requested_at),
  }));
}
