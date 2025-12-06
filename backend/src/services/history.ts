import { Mutex } from 'async-mutex';
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
  latency_ms: number | null;
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
  latencyMs?: number | null;
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
  latencyMs: number | null;
  requestedAt: Date;
}

export interface PlayerQueryPage {
  rows: PlayerQuerySummary[];
  totalCount: number;
}

export interface TopPlayer {
  identifier: string;
  resolvedUsername: string | null;
  queryCount: number;
}

const DEFAULT_PLAYER_QUERIES_LIMIT = 200;
const MAX_ALLOWED_LIMIT = 10000;

// Add a buffer with mutex protection
const bufferMutex = new Mutex();
const historyBuffer: PlayerQueryRecord[] = [];
const MAX_HISTORY_BUFFER = 50_000;
const BATCH_FLUSH_INTERVAL = 5000; // 5 seconds
let flushInterval: NodeJS.Timeout | null = null;

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
        latency_ms INTEGER,
        requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query(`
      ALTER TABLE player_query_history
      ADD COLUMN IF NOT EXISTS latency_ms INTEGER
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

// Create a new flush function
async function flushHistoryBuffer(): Promise<void> {
  // Atomically copy and clear buffer
  const batch = await bufferMutex.runExclusive(() => {
    if (historyBuffer.length === 0) {
      return [];
    }
    const copy = [...historyBuffer];
    historyBuffer.length = 0;
    return copy;
  });

  if (batch.length === 0) return;

  await ensureInitialized();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Build bulk INSERT with VALUES clause
    const values = batch.map((_: PlayerQueryRecord, i: number) => {
      const base = i * 13;
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10}, $${base + 11}, $${base + 12}, $${base + 13})`;
    }).join(', ');

    const params = batch.flatMap((record: PlayerQueryRecord) => [
      record.identifier, record.normalizedIdentifier, record.lookupType,
      record.resolvedUuid, record.resolvedUsername, record.stars,
      record.nicked, record.cacheSource, record.cacheHit,
      record.revalidated, record.installId, record.responseStatus,
      record.latencyMs ?? null,
    ]);

    const queryText = `
      INSERT INTO player_query_history (
        identifier, normalized_identifier, lookup_type, resolved_uuid, 
        resolved_username, stars, nicked, cache_source, cache_hit, 
        revalidated, install_id, response_status, latency_ms
      ) VALUES ${values}
    `;

    await client.query(queryText, params);
    await client.query('COMMIT');
    console.info(`[history] Flushed ${batch.length} records in batch`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[history] Failed to flush batch', err);
    // Put items back in buffer for retry (with mutex protection)
    await bufferMutex.runExclusive(() => {
      historyBuffer.unshift(...batch); // unshift to preserve order
    });
  } finally {
    client.release();
  }
}

// Replace the existing recordPlayerQuery with this buffered version
export async function recordPlayerQuery(record: PlayerQueryRecord): Promise<void> {
  // Push to memory instead of writing immediately (with mutex protection)
  await bufferMutex.runExclusive(() => {
    if (historyBuffer.length >= MAX_HISTORY_BUFFER) {
      // Drop oldest entry to prevent unbounded growth
      historyBuffer.shift();
      console.warn(
        `[history] buffer at capacity (${MAX_HISTORY_BUFFER}); dropping oldest entry to admit new records`,
      );
    }
    historyBuffer.push(record);
  });
}

// Start the interval in your initialization logic
export function startHistoryFlushInterval(): void {
  if (flushInterval !== null) {
    return; // Already started
  }
  flushInterval = setInterval(() => {
    void flushHistoryBuffer().catch((error) => {
      console.error('[history] Unhandled error in flush interval', error);
    });
  }, BATCH_FLUSH_INTERVAL);
}

// Stop the interval for graceful shutdown
export function stopHistoryFlushInterval(): void {
  if (flushInterval !== null) {
    clearInterval(flushInterval);
    flushInterval = null;
  }
}

// Export flushHistoryBuffer for graceful shutdown
export { flushHistoryBuffer };

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
        latency_ms,
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
    latencyMs: row.latency_ms ?? null,
    requestedAt: new Date(row.requested_at),
  }));
}

function buildDateRangeClause(
  startDate: Date | undefined,
  endDate: Date | undefined,
  startIndex: number,
): { clause: string; params: (Date | string)[] } {
  const conditions: string[] = [];
  const params: (Date | string)[] = [];
  let paramIndex = startIndex;

  if (startDate) {
    conditions.push(`requested_at >= $${paramIndex}`);
    params.push(startDate);
    paramIndex++;
  }

  if (endDate) {
    conditions.push(`requested_at <= $${paramIndex}`);
    params.push(endDate);
    paramIndex++;
  }

  if (conditions.length === 0) {
    return { clause: '', params: [] };
  }

  return { clause: `WHERE ${conditions.join(' AND ')}`, params };
}

export async function getPlayerQueriesWithFilters(params: {
  startDate?: Date;
  endDate?: Date;
  limit?: number;
}): Promise<PlayerQuerySummary[]> {
  await ensureInitialized();

  const { clause: dateClause, params: dateParams } = buildDateRangeClause(
    params.startDate,
    params.endDate,
    1,
  );

  // If time filters are present but no limit specified, use MAX_ALLOWED_LIMIT
  // to show all data within the time range. Otherwise, use default limit.
  const hasTimeFilters = params.startDate !== undefined || params.endDate !== undefined;
  const requestedLimit = params.limit !== undefined && params.limit > 0
    ? Math.min(params.limit, MAX_ALLOWED_LIMIT)
    : (hasTimeFilters ? MAX_ALLOWED_LIMIT : DEFAULT_PLAYER_QUERIES_LIMIT);
  const limitClause = `LIMIT $${dateParams.length + 1}`;
  const queryParams = [...dateParams, requestedLimit];

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
        latency_ms,
        requested_at
      FROM player_query_history
      ${dateClause}
      ORDER BY requested_at DESC
      ${limitClause}
    `,
    queryParams,
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
    latencyMs: row.latency_ms ?? null,
    requestedAt: new Date(row.requested_at),
  }));
}

export async function getTopPlayersByQueryCount(params: {
  startDate?: Date;
  endDate?: Date;
  limit?: number;
}): Promise<TopPlayer[]> {
  await ensureInitialized();

  const { clause: dateClause, params: dateParams } = buildDateRangeClause(
    params.startDate,
    params.endDate,
    1,
  );

  const limit = params.limit ?? 20;
  const queryParams = [...dateParams, limit];

  const result = await pool.query<{
    normalized_identifier: string;
    resolved_username: string | null;
    query_count: string;
  }>(
    `
      SELECT
        normalized_identifier,
        MAX(resolved_username) as resolved_username,
        COUNT(*) as query_count
      FROM player_query_history
      ${dateClause}
      GROUP BY normalized_identifier
      ORDER BY query_count DESC
      LIMIT $${dateParams.length + 1}
    `,
    queryParams,
  );

  return result.rows.map((row) => ({
    identifier: row.normalized_identifier,
    resolvedUsername: row.resolved_username,
    queryCount: Number.parseInt(row.query_count, 10),
  }));
}

function escapeSearchTerm(term: string): string {
  return term.replace(/[%_\\]/g, (match) => `\\${match}`);
}

function buildSearchClause(searchTerm: string | undefined, startIndex: number): { clause: string; params: string[] } {
  if (!searchTerm) {
    return { clause: '', params: [] };
  }

  const placeholder = `$${startIndex}`;
  const searchValue = `%${escapeSearchTerm(searchTerm)}%`;
  const clause = `WHERE normalized_identifier ILIKE ${placeholder} ESCAPE '\\\\' OR resolved_username ILIKE ${placeholder} ESCAPE '\\\\' OR resolved_uuid ILIKE ${placeholder} ESCAPE '\\\\'`;

  return { clause, params: [searchValue] };
}

export async function getPlayerQueryCount(params: { search?: string }): Promise<number> {
  await ensureInitialized();

  const searchTerm = params.search?.trim();
  const { clause, params: searchParams } = buildSearchClause(searchTerm, 1);

  const countResult = await pool.query<{ count: string }>(
    `
      SELECT COUNT(*) AS count
      FROM player_query_history
      ${clause}
    `,
    searchParams,
  );

  return Number.parseInt(countResult.rows[0]?.count ?? '0', 10);
}

export async function getPlayerQueryPage(params: {
  page: number;
  pageSize: number;
  search?: string;
  totalCountOverride?: number;
}): Promise<PlayerQueryPage> {
  await ensureInitialized();

  const page = Number.isFinite(params.page) && params.page > 0 ? Math.floor(params.page) : 1;
  const pageSize = Math.min(Math.max(Math.floor(params.pageSize) || 1, 1), 200);
  const offset = (page - 1) * pageSize;

  const searchTerm = params.search?.trim();
  const hasSearch = Boolean(searchTerm);
  const { clause: whereClause, params: searchParams } = buildSearchClause(searchTerm, 3);

  const rowsResult = await pool.query<PlayerQueryHistoryRow>(
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
        latency_ms,
        requested_at
      FROM player_query_history
      ${whereClause}
      ORDER BY requested_at DESC
      LIMIT $1
      OFFSET $2
    `,
    hasSearch ? [pageSize, offset, ...searchParams] : [pageSize, offset],
  );

  let totalCount = params.totalCountOverride;
  if (totalCount === undefined) {
    const { clause: countWhereClause, params: countParams } = buildSearchClause(searchTerm, 1);
    const countResult = await pool.query<{ count: string }>(
      `
        SELECT COUNT(*) AS count
        FROM player_query_history
        ${countWhereClause}
      `,
      countParams,
    );

    totalCount = Number.parseInt(countResult.rows[0]?.count ?? '0', 10);
  }

  return {
    rows: rowsResult.rows.map((row) => ({
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
      latencyMs: row.latency_ms ?? null,
      requestedAt: new Date(row.requested_at),
    })),
    totalCount,
  };
}
