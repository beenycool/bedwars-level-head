import { Mutex } from 'async-mutex';
import { pool } from './cache';
import { DatabaseType } from './database/adapter';

interface PlayerQueryHistoryRow {
  id: string | number;
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
  requested_at: Date | string;
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
let supportsPgTotalRelationSize: boolean | null = null;

const initialization = (async () => {
  try {
    if (pool.type === DatabaseType.POSTGRESQL) {
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
      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_player_query_history_latency
        ON player_query_history (latency_ms)
      `);

      // Detect whether pg_total_relation_size exists
      try {
        await pool.query(`SELECT pg_total_relation_size('player_cache') as size_check`);
        supportsPgTotalRelationSize = true;
      } catch (err) {
        supportsPgTotalRelationSize = false;
        console.info('[history] pg_total_relation_size not available; DB size queries will be skipped');
      }
    } else {
      await pool.query(`
        IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[player_query_history]') AND type in (N'U'))
        CREATE TABLE player_query_history (
          id BIGINT IDENTITY(1,1) PRIMARY KEY,
          identifier NVARCHAR(MAX) NOT NULL,
          normalized_identifier NVARCHAR(450) NOT NULL,
          lookup_type NVARCHAR(MAX) NOT NULL,
          resolved_uuid NVARCHAR(MAX),
          resolved_username NVARCHAR(MAX),
          stars INTEGER,
          nicked BIT NOT NULL DEFAULT 0,
          cache_source NVARCHAR(MAX) NOT NULL,
          cache_hit BIT NOT NULL DEFAULT 0,
          revalidated BIT NOT NULL DEFAULT 0,
          install_id NVARCHAR(MAX),
          response_status INTEGER NOT NULL,
          latency_ms INTEGER,
          requested_at DATETIME2 NOT NULL DEFAULT GETDATE()
        )
      `);
      await pool.query("IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[player_query_history]') AND name = 'latency_ms') ALTER TABLE player_query_history ADD latency_ms INTEGER");
      await pool.query("IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'idx_player_query_history_requested_at') CREATE INDEX idx_player_query_history_requested_at ON player_query_history (requested_at DESC)");
      await pool.query("IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'idx_player_query_history_identifier') CREATE INDEX idx_player_query_history_identifier ON player_query_history (normalized_identifier)");
      await pool.query("IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'idx_player_query_history_latency') CREATE INDEX idx_player_query_history_latency ON player_query_history (latency_ms)");
      
      supportsPgTotalRelationSize = false;
    }
  } catch (error) {
    console.error('Failed to initialize player_query_history table', error);
    throw error;
  }
})();

async function ensureInitialized(): Promise<void> {
  await initialization;
}

async function flushHistoryBuffer(): Promise<void> {
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

  try {
    // Adapter handles basic parameter conversion. For bulk insert, we'll build it manually or use simple loops if needed.
    // For now, let's keep it simple and use a single query with many parameters.
    
    const rows: string[] = [];

    const rowStrings = batch.map((record, i) => {
      const base = i * 13;
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10}, $${base + 11}, $${base + 12}, $${base + 13})`;
    }).join(', ');

    const params = batch.flatMap((record: PlayerQueryRecord) => [
      record.identifier, record.normalizedIdentifier, record.lookupType,
      record.resolvedUuid, record.resolvedUsername, record.stars,
      record.nicked, record.cacheSource, record.cacheHit,
      record.revalidated, record.installId, record.responseStatus,
      record.latencyMs != null ? Math.round(record.latencyMs) : null,
    ]);

    const queryText = `
      INSERT INTO player_query_history (
        identifier, normalized_identifier, lookup_type, resolved_uuid,
        resolved_username, stars, nicked, cache_source, cache_hit,
        revalidated, install_id, response_status, latency_ms
      ) VALUES ${rowStrings}
    `;

    // Note: AzureSqlAdapter.query currently does $ to @ replacement, but we built @ explicitly for MS SQL here.
    // We should be careful about double replacement if we use $ here.
    // Actually, our adapter replaces $1, $2 with @p1, @p2. So if we use $ consistently, it should work.
    
    const universalRows = batch.map((_, i) => {
      const base = i * 13;
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10}, $${base + 11}, $${base + 12}, $${base + 13})`;
    });
    
    const universalQuery = `
      INSERT INTO player_query_history (
        identifier, normalized_identifier, lookup_type, resolved_uuid, 
        resolved_username, stars, nicked, cache_source, cache_hit, 
        revalidated, install_id, response_status, latency_ms
      ) VALUES ${universalRows.join(', ')}
    `;

    await pool.query(universalQuery, params);
    console.info(`[history] Flushed ${batch.length} records in batch`);
  } catch (err) {
    console.error('[history] Failed to flush batch', err);
    await bufferMutex.runExclusive(() => {
      historyBuffer.unshift(...batch);
    });
  }
}

export async function recordPlayerQuery(record: PlayerQueryRecord): Promise<void> {
  await bufferMutex.runExclusive(() => {
    if (historyBuffer.length >= MAX_HISTORY_BUFFER) {
      historyBuffer.shift();
      console.warn(`[history] buffer at capacity (${MAX_HISTORY_BUFFER}); dropping oldest entry`);
    }
    historyBuffer.push(record);
  });
}

export function startHistoryFlushInterval(): void {
  if (flushInterval !== null) return;
  flushInterval = setInterval(() => {
    void flushHistoryBuffer().catch((error) => {
      console.error('[history] Unhandled error in flush interval', error);
    });
  }, BATCH_FLUSH_INTERVAL);
}

export function stopHistoryFlushInterval(): void {
  if (flushInterval !== null) {
    clearInterval(flushInterval);
    flushInterval = null;
  }
}

export { flushHistoryBuffer };

export async function getRecentPlayerQueries(limit = 50): Promise<PlayerQuerySummary[]> {
  await ensureInitialized();
  const sql = pool.type === DatabaseType.POSTGRESQL
    ? `SELECT identifier, normalized_identifier, lookup_type, resolved_uuid, resolved_username, stars, nicked, cache_source, cache_hit, revalidated, install_id, response_status, latency_ms, requested_at
       FROM player_query_history ORDER BY requested_at DESC LIMIT $1`
    : `SELECT TOP ($1) identifier, normalized_identifier, lookup_type, resolved_uuid, resolved_username, stars, nicked, cache_source, cache_hit, revalidated, install_id, response_status, latency_ms, requested_at
       FROM player_query_history ORDER BY requested_at DESC`;

  const result = await pool.query<PlayerQueryHistoryRow>(sql, [limit]);

  return result.rows.map(mapRowToSummary);
}

function mapRowToSummary(row: PlayerQueryHistoryRow): PlayerQuerySummary {
  return {
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
  };
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

  const hasTimeFilters = params.startDate !== undefined || params.endDate !== undefined;
  const requestedLimit = params.limit !== undefined && params.limit > 0
    ? Math.min(params.limit, MAX_ALLOWED_LIMIT)
    : (hasTimeFilters ? MAX_ALLOWED_LIMIT : DEFAULT_PLAYER_QUERIES_LIMIT);
  
  const queryParams = [...dateParams, requestedLimit];
  
  let sql;
  if (pool.type === DatabaseType.POSTGRESQL) {
    sql = `
      SELECT identifier, normalized_identifier, lookup_type, resolved_uuid, resolved_username, stars, nicked, cache_source, cache_hit, revalidated, install_id, response_status, latency_ms, requested_at
      FROM player_query_history
      ${dateClause}
      ORDER BY requested_at DESC
      LIMIT $${dateParams.length + 1}
    `;
  } else {
    sql = `
      SELECT TOP ($${dateParams.length + 1}) identifier, normalized_identifier, lookup_type, resolved_uuid, resolved_username, stars, nicked, cache_source, cache_hit, revalidated, install_id, response_status, latency_ms, requested_at
      FROM player_query_history
      ${dateClause}
      ORDER BY requested_at DESC
    `;
  }

  const result = await pool.query<PlayerQueryHistoryRow>(sql, queryParams);
  return result.rows.map(mapRowToSummary);
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

  let sql;
  if (pool.type === DatabaseType.POSTGRESQL) {
    sql = `
      SELECT normalized_identifier, MAX(resolved_username) as resolved_username, COUNT(*) as query_count
      FROM player_query_history
      ${dateClause}
      GROUP BY normalized_identifier
      ORDER BY query_count DESC
      LIMIT $${dateParams.length + 1}
    `;
  } else {
    sql = `
      SELECT TOP ($${dateParams.length + 1}) normalized_identifier, MAX(resolved_username) as resolved_username, COUNT(*) as query_count
      FROM player_query_history
      ${dateClause}
      GROUP BY normalized_identifier
      ORDER BY query_count DESC
    `;
  }

  const result = await pool.query<{
    normalized_identifier: string;
    resolved_username: string | null;
    query_count: string | number;
  }>(sql, queryParams);

  return result.rows.map((row) => ({
    identifier: row.normalized_identifier,
    resolvedUsername: row.resolved_username,
    queryCount: typeof row.query_count === 'string' ? Number.parseInt(row.query_count, 10) : Number(row.query_count),
  }));
}

function buildSearchClause(searchTerm: string | undefined, startIndex: number): { clause: string; params: string[] } {
  if (!searchTerm) {
    return { clause: '', params: [] };
  }

  const placeholder = `$${startIndex}`;
  const searchValue = `%${searchTerm.replace(/[%_\\]/g, (match) => `\\${match}`)}%`;
  
  let clause;
  if (pool.type === DatabaseType.POSTGRESQL) {
    clause = `WHERE normalized_identifier ILIKE ${placeholder} ESCAPE '\\\\' OR resolved_username ILIKE ${placeholder} ESCAPE '\\\\' OR resolved_uuid ILIKE ${placeholder} ESCAPE '\\\\'`;
  } else {
    // SQL Server is usually case-insensitive by default with its default collation.
    // We use [key] notation for identifier if it's a reserved word, but here they aren't.
    clause = `WHERE normalized_identifier LIKE ${placeholder} ESCAPE '\\' OR resolved_username LIKE ${placeholder} ESCAPE '\\' OR resolved_uuid LIKE ${placeholder} ESCAPE '\\'`;
  }

  return { clause, params: [searchValue] };
}

export async function getPlayerQueryCount(params: { search?: string }): Promise<number> {
  await ensureInitialized();
  const searchTerm = params.search?.trim();
  const { clause, params: searchParams } = buildSearchClause(searchTerm, 1);

  const result = await pool.query<{ count: string | number }>(
    `SELECT COUNT(*) AS count FROM player_query_history ${clause}`,
    searchParams,
  );

  const raw = result.rows[0]?.count ?? '0';
  return typeof raw === 'string' ? Number.parseInt(raw, 10) : Number(raw);
}

export async function getPlayerQueryPage(params: {
  page: number;
  pageSize: number;
  search?: string;
  totalCountOverride?: number;
}): Promise<PlayerQueryPage> {
  await ensureInitialized();

  const page = Math.max(Math.floor(params.page) || 1, 1);
  const pageSize = Math.min(Math.max(Math.floor(params.pageSize) || 1, 1), 200);
  const offset = (page - 1) * pageSize;

  const searchTerm = params.search?.trim();
  const { clause: whereClause, params: searchParams } = buildSearchClause(searchTerm, 3);

  let sql;
  if (pool.type === DatabaseType.POSTGRESQL) {
    sql = `
      SELECT identifier, normalized_identifier, lookup_type, resolved_uuid, resolved_username, stars, nicked, cache_source, cache_hit, revalidated, install_id, response_status, latency_ms, requested_at
      FROM player_query_history
      ${whereClause}
      ORDER BY requested_at DESC
      LIMIT $1 OFFSET $2
    `;
  } else {
    sql = `
      SELECT identifier, normalized_identifier, lookup_type, resolved_uuid, resolved_username, stars, nicked, cache_source, cache_hit, revalidated, install_id, response_status, latency_ms, requested_at
      FROM player_query_history
      ${whereClause}
      ORDER BY requested_at DESC
      OFFSET $2 ROWS FETCH NEXT $1 ROWS ONLY
    `;
  }

  const rowsResult = await pool.query<PlayerQueryHistoryRow>(sql, [pageSize, offset, ...searchParams]);

  let totalCount = params.totalCountOverride;
  if (totalCount === undefined) {
    totalCount = await getPlayerQueryCount({ search: searchTerm });
  }

  return {
    rows: rowsResult.rows.map(mapRowToSummary),
    totalCount,
  };
}

export interface SystemStats {
  dbSize: string;
  indexSize: string;
  cacheCount: number;
  apiCallsLastHour: number;
  avgPayloadSize: string;
}

export async function getSystemStats(): Promise<SystemStats> {
  await ensureInitialized();

  let tableStatsPromise;
  if (pool.type === DatabaseType.POSTGRESQL && supportsPgTotalRelationSize !== false) {
    tableStatsPromise = pool.query(`
      SELECT pg_total_relation_size('player_cache') as total_size_bytes,
             (pg_total_relation_size('player_cache') - pg_relation_size('player_cache')) as index_size_bytes
    `).catch(() => ({ rows: [{ total_size_bytes: null, index_size_bytes: null }] }));
  } else if (pool.type === DatabaseType.AZURE_SQL) {
    // SQL Server equivalent for table size
    tableStatsPromise = pool.query(`
      SELECT 
        (SUM(a.total_pages) * 8 * 1024) AS total_size_bytes,
        (SUM(a.used_pages) * 8 * 1024 - SUM(CASE WHEN p.index_id < 2 THEN a.data_pages ELSE 0 END) * 8 * 1024) AS index_size_bytes
      FROM sys.tables t
      JOIN sys.indexes i ON t.object_id = i.object_id
      JOIN sys.partitions p ON i.object_id = p.object_id AND i.index_id = p.index_id
      JOIN sys.allocation_units a ON p.partition_id = a.container_id
      WHERE t.name = 'player_cache'
      GROUP BY t.name
    `).catch(() => ({ rows: [{ total_size_bytes: null, index_size_bytes: null }] }));
  } else {
    tableStatsPromise = Promise.resolve({ rows: [{ total_size_bytes: null, index_size_bytes: null }] });
  }

  const apiStatsQuery = pool.type === DatabaseType.POSTGRESQL
    ? `SELECT count(*) as count FROM hypixel_api_calls WHERE called_at >= (EXTRACT(EPOCH FROM NOW() - INTERVAL '1 hour') * 1000)`
    : `SELECT count(*) as count FROM hypixel_api_calls WHERE called_at >= (DATEDIFF_BIG(ms, '1970-01-01', DATEADD(hour, -1, GETDATE())))`;

  const apiStatsPromise = pool.query<{ count: string | number }>(apiStatsQuery)
    .catch(() => ({ rows: [{ count: 0 }] }));

  const cacheStatsQuery = pool.type === DatabaseType.POSTGRESQL
    ? `SELECT count(*) as count, avg(octet_length(payload::text)) as avg_size_bytes FROM player_cache`
    : `SELECT count(*) as count, avg(len(payload)) as avg_size_bytes FROM player_cache`;

  const cacheStatsPromise = pool.query<{ count: string | number, avg_size_bytes: string | number | null }>(cacheStatsQuery)
    .catch(() => ({ rows: [{ count: 0, avg_size_bytes: null }] }));

  const [tableStats, apiStats, cacheStats] = await Promise.all([
    tableStatsPromise,
    apiStatsPromise,
    cacheStatsPromise,
  ]);

  function bytesToHuman(raw: string | number | null | undefined): string {
    const bytes = raw === null || raw === undefined ? 0 : Number.parseInt(String(raw), 10);
    if (Number.isNaN(bytes) || bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0;
    let value = bytes;
    while (value >= 1024 && i < units.length - 1) {
      value = value / 1024;
      i += 1;
    }
    const formatted = value % 1 === 0 ? String(value) : value.toFixed(1);
    return `${formatted} ${units[i]}`;
  }

  return {
    dbSize: bytesToHuman((tableStats.rows[0] as any)?.total_size_bytes),
    indexSize: bytesToHuman((tableStats.rows[0] as any)?.index_size_bytes),
    apiCallsLastHour: Number((apiStats.rows[0] as any)?.count ?? 0),
    cacheCount: Number((cacheStats.rows[0] as any)?.count ?? 0),
    avgPayloadSize: bytesToHuman((cacheStats.rows[0] as any)?.avg_size_bytes)
  };
}
