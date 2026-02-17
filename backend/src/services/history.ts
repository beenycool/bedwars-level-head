import { Mutex } from 'async-mutex';
import pLimit from 'p-limit';
import { pool } from './cache';
import { DatabaseType } from './database/adapter';
import { getRedisCacheStats } from './redis';
import { getCurrentResourceMetrics, CurrentResourceMetrics } from './resourceMetrics';

interface PlayerQueryHistoryRow { id: string | number; identifier: string; normalized_identifier: string; lookup_type: 'uuid' | 'ign'; resolved_uuid: string | null; resolved_username: string | null; stars: number | null; nicked: boolean; cache_source: string; cache_hit: boolean; revalidated: boolean; install_id: string | null; response_status: number; latency_ms: number | null; requested_at: Date | string; }
export interface PlayerQueryRecord { identifier: string; normalizedIdentifier: string; lookupType: 'uuid' | 'ign'; resolvedUuid: string | null; resolvedUsername: string | null; stars: number | null; nicked: boolean; cacheSource: 'cache' | 'network'; cacheHit: boolean; revalidated: boolean; installId: string | null; responseStatus: number; latencyMs?: number | null; }
export interface PlayerQuerySummary { identifier: string; normalizedIdentifier: string; lookupType: 'uuid' | 'ign'; resolvedUuid: string | null; resolvedUsername: string | null; stars: number | null; nicked: boolean; cacheSource: 'cache' | 'network'; cacheHit: boolean; revalidated: boolean; installId: string | null; responseStatus: number; latencyMs: number | null; requestedAt: Date; }
export interface PlayerQueryStatsSummary { lookupType: 'uuid' | 'ign'; stars: number | null; cacheHit: boolean; responseStatus: number; latencyMs: number | null; requestedAt: Date; }
interface PlayerQueryStatsRow { lookup_type: 'uuid' | 'ign'; stars: number | null; cache_hit: boolean; response_status: number; latency_ms: number | null; requested_at: Date | string; }
export interface PlayerQueryPage { rows: PlayerQuerySummary[]; totalCount: number; }
export interface TopPlayer { identifier: string; resolvedUsername: string | null; queryCount: number; }

const DEFAULT_PLAYER_QUERIES_LIMIT = 200;
const MAX_ALLOWED_LIMIT = 10000;
const CONCURRENT_HISTORY_FETCHES = 5;

const bufferMutex = new Mutex();
const historyBuffer: PlayerQueryRecord[] = [];
const MAX_HISTORY_BUFFER = 50_000;
const BATCH_FLUSH_INTERVAL = 5000;
let flushInterval: NodeJS.Timeout | null = null;
let supportsPgTotalRelationSize: boolean | null = null;

const initialization = (async () => {
  try {
    const cols = pool.type === DatabaseType.POSTGRESQL
      ? 'id BIGSERIAL PRIMARY KEY, identifier TEXT NOT NULL, normalized_identifier TEXT NOT NULL, lookup_type TEXT NOT NULL, resolved_uuid TEXT, resolved_username TEXT, stars INTEGER, nicked BOOLEAN NOT NULL DEFAULT FALSE, cache_source TEXT NOT NULL, cache_hit BOOLEAN NOT NULL DEFAULT FALSE, revalidated BOOLEAN NOT NULL DEFAULT FALSE, install_id TEXT, response_status INTEGER NOT NULL, latency_ms INTEGER, requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW()'
      : 'id BIGINT IDENTITY(1,1) PRIMARY KEY, identifier NVARCHAR(MAX) NOT NULL, normalized_identifier NVARCHAR(450) NOT NULL, lookup_type NVARCHAR(MAX) NOT NULL, resolved_uuid NVARCHAR(MAX), resolved_username NVARCHAR(MAX), stars INTEGER, nicked BIT NOT NULL DEFAULT 0, cache_source NVARCHAR(MAX) NOT NULL, cache_hit BIT NOT NULL DEFAULT 0, revalidated BIT NOT NULL DEFAULT 0, install_id NVARCHAR(MAX), response_status INTEGER NOT NULL, latency_ms INTEGER, requested_at DATETIME2 NOT NULL DEFAULT GETDATE()';
    await pool.query(pool.getCreateTableIfNotExistsSql('player_query_history', cols));
    if (pool.type === DatabaseType.POSTGRESQL) {
      await pool.query('ALTER TABLE player_query_history ADD COLUMN IF NOT EXISTS latency_ms INTEGER');
    } else {
      await pool.query("IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[player_query_history]') AND name = 'latency_ms') ALTER TABLE player_query_history ADD latency_ms INTEGER");
    }
    await pool.query(pool.getCreateIndexIfNotExistsSql('idx_player_query_history_requested_at', 'player_query_history', 'requested_at DESC'));
    await pool.query(pool.getCreateIndexIfNotExistsSql('idx_player_query_history_identifier', 'player_query_history', 'normalized_identifier'));
    await pool.query(pool.getCreateIndexIfNotExistsSql('idx_player_query_history_latency', 'player_query_history', 'latency_ms'));
    if (pool.type === DatabaseType.POSTGRESQL) {
      try { await pool.query("SELECT pg_total_relation_size('player_stats_cache')"); supportsPgTotalRelationSize = true; }
      catch { supportsPgTotalRelationSize = false; }
    } else supportsPgTotalRelationSize = false;
  } catch (error) { console.error('Failed to init history table', error); throw error; }
})();

async function ensureInitialized(): Promise<void> { await initialization; }

async function flushHistoryBuffer(): Promise<void> {
  const batch = await bufferMutex.runExclusive(() => {
    if (historyBuffer.length === 0) return [];
    const copy = [...historyBuffer]; historyBuffer.length = 0; return copy;
  });
  if (batch.length === 0) return;
  await ensureInitialized();
  try {
    const maxParams = pool.getMaxParameters();
    const maxRecordsPerChunk = Math.max(1, Math.floor(maxParams / 13));
    let flushed = 0; const limit = pLimit(CONCURRENT_HISTORY_FETCHES); const promises = [];
    for (let offset = 0; offset < batch.length; offset += maxRecordsPerChunk) {
      const chunk = batch.slice(offset, offset + maxRecordsPerChunk);
      promises.push(limit(async () => {
        const params = chunk.flatMap((record: PlayerQueryRecord) => [
          record.identifier, record.normalizedIdentifier, record.lookupType,
          record.resolvedUuid, record.resolvedUsername, record.stars,
          record.nicked, record.cacheSource, record.cacheHit,
          record.revalidated, record.install_id, record.responseStatus,
          record.latencyMs != null ? Math.round(record.latencyMs) : null,
        ]);
        const rows = chunk.map((_, i) => {
          const base = i * 13;
          const rps = Array.from({ length: 13 }, (_, j) => pool.getPlaceholder(base + j + 1)).join(', ');
          return `(${rps})`;
        });
        await pool.query(`INSERT INTO player_query_history (identifier, normalized_identifier, lookup_type, resolved_uuid, resolved_username, stars, nicked, cache_source, cache_hit, revalidated, install_id, response_status, latency_ms) VALUES ${rows.join(', ')}`, params);
        flushed += chunk.length;
      }));
    }
    await Promise.all(promises);
    console.info(`[history] Flushed ${flushed} records`);
  } catch (err) {
    console.error('[history] Flush failed', err);
    await bufferMutex.runExclusive(() => { historyBuffer.unshift(...batch); });
  }
}

export async function recordPlayerQuery(record: PlayerQueryRecord): Promise<void> {
  await bufferMutex.runExclusive(() => {
    if (historyBuffer.length >= MAX_HISTORY_BUFFER) { historyBuffer.shift(); }
    historyBuffer.push(record);
  });
}

export function startHistoryFlushInterval(): void {
  if (flushInterval !== null) return;
  flushInterval = setInterval(() => { void flushHistoryBuffer().catch(() => {}); }, BATCH_FLUSH_INTERVAL);
}

export function stopHistoryFlushInterval(): void { if (flushInterval !== null) { clearInterval(flushInterval); flushInterval = null; } }
export { flushHistoryBuffer };

export async function getRecentPlayerQueries(limit = 50): Promise<PlayerQuerySummary[]> {
  await ensureInitialized();
  const sql = `SELECT ${pool.getTopSql(limit)} identifier, normalized_identifier, lookup_type, resolved_uuid, resolved_username, stars, nicked, cache_source, cache_hit, revalidated, install_id, response_status, latency_ms, requested_at FROM player_query_history ORDER BY requested_at DESC ${pool.getLimitOffsetSql(limit)}`;
  const result = await pool.query<PlayerQueryHistoryRow>(sql);
  return result.rows.map(mapRowToSummary);
}

function mapRowToSummary(row: PlayerQueryHistoryRow): PlayerQuerySummary {
  return {
    identifier: row.identifier, normalizedIdentifier: row.normalized_identifier, lookupType: row.lookup_type,
    resolvedUuid: row.resolved_uuid, resolvedUsername: row.resolved_username, stars: row.stars, nicked: !!row.nicked,
    cacheSource: row.cache_source as 'cache' | 'network', cacheHit: !!row.cache_hit, revalidated: !!row.revalidated,
    installId: row.install_id, responseStatus: Number(row.response_status),
    latencyMs: row.latency_ms === null ? null : Number(row.latency_ms), requestedAt: new Date(row.requested_at),
  };
}

function buildDateRangeClause(startDate: Date | undefined, endDate: Date | undefined, startIndex: number): { clause: string; params: (Date | string)[] } {
  const conditions: string[] = []; const params: (Date | string)[] = []; let paramIndex = startIndex;
  if (startDate) { conditions.push(`requested_at >= ${pool.getPlaceholder(paramIndex)}`); params.push(startDate); paramIndex++; }
  if (endDate) { conditions.push(`requested_at <= ${pool.getPlaceholder(paramIndex)}`); params.push(endDate); paramIndex++; }
  return { clause: conditions.length === 0 ? '' : `WHERE ${conditions.join(' AND ')}`, params };
}

export async function getPlayerQueriesWithFilters(params: { startDate?: Date; endDate?: Date; limit?: number }): Promise<PlayerQuerySummary[]> {
  await ensureInitialized();
  const { clause: dateClause, params: dateParams } = buildDateRangeClause(params.startDate, params.endDate, 1);
  const hasTimeFilters = params.startDate !== undefined || params.endDate !== undefined;
  const limit = params.limit !== undefined && params.limit > 0 ? Math.min(params.limit, MAX_ALLOWED_LIMIT) : (hasTimeFilters ? MAX_ALLOWED_LIMIT : DEFAULT_PLAYER_QUERIES_LIMIT);
  const sql = `SELECT ${pool.getTopSql(limit)} identifier, normalized_identifier, lookup_type, resolved_uuid, resolved_username, stars, nicked, cache_source, cache_hit, revalidated, install_id, response_status, latency_ms, requested_at FROM player_query_history ${dateClause} ORDER BY requested_at DESC ${pool.getLimitOffsetSql(limit)}`;
  const result = await pool.query<PlayerQueryHistoryRow>(sql, dateParams);
  return result.rows.map(mapRowToSummary);
}

export async function getPlayerQueriesStats(params: { startDate?: Date; endDate?: Date; limit?: number }): Promise<PlayerQueryStatsSummary[]> {
  await ensureInitialized();
  const { clause: dateClause, params: dateParams } = buildDateRangeClause(params.startDate, params.endDate, 1);
  const hasTimeFilters = params.startDate !== undefined || params.endDate !== undefined;
  const limit = params.limit !== undefined && params.limit > 0 ? Math.min(params.limit, MAX_ALLOWED_LIMIT) : (hasTimeFilters ? MAX_ALLOWED_LIMIT : DEFAULT_PLAYER_QUERIES_LIMIT);
  const sql = `SELECT ${pool.getTopSql(limit)} lookup_type, stars, cache_hit, response_status, latency_ms, requested_at FROM player_query_history ${dateClause} ORDER BY requested_at DESC ${pool.getLimitOffsetSql(limit)}`;
  const result = await pool.query<PlayerQueryStatsRow>(sql, dateParams);
  return result.rows.map((row) => ({
    lookupType: row.lookup_type, stars: row.stars, cacheHit: !!row.cache_hit, responseStatus: Number(row.response_status),
    latencyMs: row.latency_ms === null ? null : Number(row.latency_ms), requestedAt: new Date(row.requested_at),
  }));
}

export async function getTopPlayersByQueryCount(params: { startDate?: Date; endDate?: Date; limit?: number }): Promise<TopPlayer[]> {
  await ensureInitialized();
  const { clause: dateClause, params: dateParams } = buildDateRangeClause(params.startDate, params.endDate, 1);
  const limit = params.limit ?? 20;
  const sql = `SELECT ${pool.getTopSql(limit)} normalized_identifier, MAX(resolved_username) as resolved_username, COUNT(*) as query_count FROM player_query_history ${dateClause} GROUP BY normalized_identifier ORDER BY query_count DESC ${pool.getLimitOffsetSql(limit)}`;
  const result = await pool.query<{ normalized_identifier: string; resolved_username: string | null; query_count: string | number }>(sql, dateParams);
  return result.rows.map((row) => ({
    identifier: row.normalized_identifier, resolvedUsername: row.resolved_username,
    queryCount: Number(row.query_count),
  }));
}

export function buildSearchClause(searchTerm: string | undefined, startIndex: number): { clause: string; params: string[] } {
  if (!searchTerm) return { clause: '', params: [] };
  const p = pool.getPlaceholder(startIndex);
  const searchValue = `%${searchTerm.replace(/[%_\\]/g, (match) => `\\${match}`)}%`;
  const clause = `WHERE (${pool.getIlikeSql('normalized_identifier', p)} OR ${pool.getIlikeSql('resolved_username', p)} OR ${pool.getIlikeSql('resolved_uuid', p)}) ESCAPE '\\'`;
  return { clause, params: [searchValue] };
}

export async function getPlayerQueryCount(params: { search?: string }): Promise<number> {
  await ensureInitialized();
  const { clause, params: searchParams } = buildSearchClause(params.search?.trim(), 1);
  const result = await pool.query<{ count: string | number }>(`SELECT COUNT(*) AS count FROM player_query_history ${clause}`, searchParams);
  return Number(result.rows[0]?.count ?? 0);
}

export async function getPlayerQueryPage(params: { page: number; pageSize: number; search?: string; totalCountOverride?: number }): Promise<PlayerQueryPage> {
  await ensureInitialized();
  const page = Math.max(Math.floor(params.page) || 1, 1);
  const pageSize = Math.min(Math.max(Math.floor(params.pageSize) || 1, 1), 200);
  const offset = (page - 1) * pageSize;
  const { clause: whereClause, params: searchParams } = buildSearchClause(params.search?.trim(), 1);
  const sql = `SELECT identifier, normalized_identifier, lookup_type, resolved_uuid, resolved_username, stars, nicked, cache_source, cache_hit, revalidated, install_id, response_status, latency_ms, requested_at FROM player_query_history ${whereClause} ORDER BY requested_at DESC ${pool.getLimitOffsetSql(pageSize, offset)}`;
  const rowsResult = await pool.query<PlayerQueryHistoryRow>(sql, searchParams);
  let totalCount = params.totalCountOverride;
  if (totalCount === undefined) totalCount = await getPlayerQueryCount({ search: params.search });
  return { rows: rowsResult.rows.map(mapRowToSummary), totalCount };
}

export type ResourceMetrics = CurrentResourceMetrics;
export interface SystemStats { dbSize: string; indexSize: string; cacheCount: number; apiCallsLastHour: number; avgPayloadSize: string; resourceMetrics: ResourceMetrics; }

export async function getSystemStats(): Promise<SystemStats> {
  await ensureInitialized();
  const redisCacheStats = await getRedisCacheStats();
  const resourceMetrics = await getCurrentResourceMetrics();
  const apiStatsQuery = `SELECT count(*) as count FROM hypixel_api_calls WHERE called_at >= ${pool.getEpochMsSql(pool.getDateMinusIntervalSql(1, 'hour'))}`;
  const apiStats = await pool.query<{ count: string | number }>(apiStatsQuery).catch(() => ({ rows: [{ count: 0 }] }));
  return {
    dbSize: redisCacheStats.memoryUsed, indexSize: 'N/A (Redis)',
    apiCallsLastHour: Number(apiStats.rows[0]?.count ?? 0),
    cacheCount: redisCacheStats.cacheKeys,
    avgPayloadSize: 'N/A', resourceMetrics,
  };
}
