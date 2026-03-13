import { CACHE_DB_ALLOW_COLD_READS, CACHE_DB_WARM_WINDOW_MS, HYPIXEL_API_CALL_WINDOW_MS } from '../config';
import { recordCacheHit, recordCacheMiss } from './metrics';
import { db, dbType } from './database/db';
import { sql } from 'kysely';
import { DatabaseType } from './database/db';
import { ensureCockroachRowLevelTtl, isCockroachTtlManaged } from './database/cockroachTtl';

import { logger } from '../util/logger';
import {
    getPlayerCacheEntry,
    setPlayerCacheEntry,
    clearAllPlayerCacheEntries,
    deletePlayerCacheEntries,
    isRedisAvailable,
} from './redis';

interface DatabaseError extends Error {
  code?: string | number;
  constraint?: string;
}

interface CacheRow {
  payload: unknown;
  expires_at: number | string;
  cached_at?: number | string | null;
  etag: string | null;
  last_modified: number | string | null;
  source: string | null;
}

export type CacheSource = 'hypixel' | 'community_verified' | 'community_unverified';

export interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  etag: string | null;
  lastModified: number | null;
  source: CacheSource | null;
}

export interface CacheMetadata {
  etag?: string | null;
  lastModified?: number | null;
  source?: CacheSource | null;
}

let lastDbAccessAt = 0;

export function markDbAccess(): void {
  lastDbAccessAt = Date.now();
}

export function shouldReadFromDb(): boolean {
  if (CACHE_DB_ALLOW_COLD_READS) {
    return true;
  }
  if (CACHE_DB_WARM_WINDOW_MS <= 0) {
    return false;
  }
  if (lastDbAccessAt === 0) {
    // Allow the first L2 read after startup to seed the warm window.
    lastDbAccessAt = Date.now();
    return true;
  }
  return Date.now() - lastDbAccessAt < CACHE_DB_WARM_WINDOW_MS;
}

// Re-export pool for other services
export { db as pool };

function buildCockroachTimestampExpression(columnName: string): string {
  return `to_timestamp(${columnName}::FLOAT / 1000.0)`;
}

function buildCockroachRetentionExpression(columnName: string, ttlMs: number): string {
  const ttlSeconds = Math.max(1, Math.ceil(ttlMs / 1000));
  return `${buildCockroachTimestampExpression(columnName)} + '${ttlSeconds} seconds'::INTERVAL`;
}

async function ensureRateLimitTable(): Promise<void> {
  try {
    if (dbType === DatabaseType.POSTGRESQL) {
      await sql.raw(
        `CREATE TABLE IF NOT EXISTS rate_limits (
          key TEXT PRIMARY KEY,
          count BIGINT NOT NULL,
          window_start BIGINT NOT NULL
        )`,
      );
    } else {
      await sql.raw(
        `IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[rate_limits]') AND type in (N'U'))
         CREATE TABLE rate_limits (
           [key] NVARCHAR(450) PRIMARY KEY,
           [count] BIGINT NOT NULL,
           window_start BIGINT NOT NULL
         )`,
      );
    }
  } catch (error) {
    const dbError = error as DatabaseError | undefined;
    if (dbError?.code !== '42P07' && dbError?.code !== 2714) {
      throw error;
    }
  }

  if (dbType === DatabaseType.POSTGRESQL) {
    const columnInfo = await sql<{ data_type: string }>`SELECT data_type FROM information_schema.columns WHERE table_name = 'rate_limits' AND table_schema = current_schema() AND column_name = 'count'`.execute(db);
    const dataType = columnInfo.rows[0]?.data_type;
    if (dataType && dataType.toLowerCase() !== 'bigint') {
      await sql`ALTER TABLE rate_limits ALTER COLUMN count TYPE BIGINT USING count::BIGINT`.execute(db);
      logger.info('[cache] migrated rate_limits.count column to BIGINT');
    }
  }
}

async function ensurePlayerStatsTables(): Promise<void> {
  if (dbType === DatabaseType.POSTGRESQL) {
    await sql.raw(
      `CREATE TABLE IF NOT EXISTS player_stats_cache (
        cache_key TEXT PRIMARY KEY,
        payload JSONB NOT NULL,
        expires_at BIGINT NOT NULL,
        cached_at BIGINT,
        etag TEXT,
        last_modified BIGINT,
        source TEXT DEFAULT 'hypixel',
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`,
    );
    await sql`ALTER TABLE player_stats_cache ADD COLUMN IF NOT EXISTS cached_at BIGINT`.execute(db);
    await sql.raw(
      `CREATE INDEX IF NOT EXISTS idx_player_stats_expires ON player_stats_cache (expires_at)`,
    );

    await sql.raw(
      `CREATE TABLE IF NOT EXISTS ign_uuid_cache (
        ign TEXT PRIMARY KEY,
        uuid TEXT,
        nicked BOOLEAN NOT NULL DEFAULT FALSE,
        expires_at BIGINT NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`,
    );
    await sql.raw(
      `CREATE INDEX IF NOT EXISTS idx_ign_uuid_expires ON ign_uuid_cache (expires_at)`,
    );
  } else {
    await sql.raw(
      `IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[player_stats_cache]') AND type in (N'U'))
       CREATE TABLE player_stats_cache (
         cache_key NVARCHAR(450) PRIMARY KEY,
         payload NVARCHAR(MAX) NOT NULL,
         expires_at BIGINT NOT NULL,
         cached_at BIGINT NULL,
         etag NVARCHAR(255),
         last_modified BIGINT,
         source NVARCHAR(64),
         created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
       )`,
    );
    await sql.raw(
      `IF COL_LENGTH('player_stats_cache', 'cached_at') IS NULL
       ALTER TABLE player_stats_cache ADD cached_at BIGINT`,
    );
    await sql.raw(
      "IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'idx_player_stats_expires') CREATE INDEX idx_player_stats_expires ON player_stats_cache (expires_at)",
    );

    await sql.raw(
      `IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[ign_uuid_cache]') AND type in (N'U'))
       CREATE TABLE ign_uuid_cache (
         ign NVARCHAR(32) PRIMARY KEY,
         uuid NVARCHAR(32),
         nicked BIT NOT NULL DEFAULT 0,
         expires_at BIGINT NOT NULL,
         updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
       )`,
    );
    await sql.raw(
      "IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'idx_ign_uuid_expires') CREATE INDEX idx_ign_uuid_expires ON ign_uuid_cache (expires_at)",
    );
  }
}

const initialization = (async () => {
  logger.info('[cache] player cache: Redis L1 + SQL L2');

  await ensureRateLimitTable();
  logger.info('[cache] rate_limits table is ready');

  await ensurePlayerStatsTables();
  logger.info('[cache] player_stats_cache tables are ready');

  if (dbType === DatabaseType.POSTGRESQL) {
    await sql.raw(
      `CREATE TABLE IF NOT EXISTS hypixel_api_calls (
        id BIGSERIAL PRIMARY KEY,
        called_at BIGINT NOT NULL,
        uuid TEXT NOT NULL
      )`,
    );
    await sql`CREATE INDEX IF NOT EXISTS idx_hypixel_calls_time ON hypixel_api_calls (called_at)`.execute(db);
    await sql`CREATE INDEX IF NOT EXISTS idx_rate_limits_window ON rate_limits (window_start)`.execute(db);
    await sql.raw(
      `CREATE TABLE IF NOT EXISTS system_kv (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )`,
    );
  } else {
    await sql.raw(
      `IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[hypixel_api_calls]') AND type in (N'U'))
       CREATE TABLE hypixel_api_calls (
         id BIGINT IDENTITY(1,1) PRIMARY KEY,
         called_at BIGINT NOT NULL,
         uuid NVARCHAR(MAX) NOT NULL
       )`,
    );
    await sql`IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'idx_hypixel_calls_time') CREATE INDEX idx_hypixel_calls_time ON hypixel_api_calls (called_at)`.execute(db);
    await sql`IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'idx_rate_limits_window') CREATE INDEX idx_rate_limits_window ON rate_limits (window_start)`.execute(db);
    await sql.raw(
      `IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[system_kv]') AND type in (N'U'))
       CREATE TABLE system_kv (
         [key] NVARCHAR(128) PRIMARY KEY,
         [value] NVARCHAR(MAX) NOT NULL
       )`,
    );
  }

  logger.info('[cache] hypixel_api_calls and system_kv tables are ready');

  await Promise.all([
    ensureCockroachRowLevelTtl({
      tableName: 'player_stats_cache',
      expirationExpression: buildCockroachTimestampExpression('expires_at'),
    }),
    ensureCockroachRowLevelTtl({
      tableName: 'ign_uuid_cache',
      expirationExpression: buildCockroachTimestampExpression('expires_at'),
    }),
    ensureCockroachRowLevelTtl({
      tableName: 'hypixel_api_calls',
      expirationExpression: buildCockroachRetentionExpression('called_at', HYPIXEL_API_CALL_WINDOW_MS),
    }),
  ]);
})();

export async function ensureInitialized(): Promise<void> {
  await initialization;
}

export async function purgeExpiredEntries(now: number = Date.now()): Promise<void> {
  await ensureInitialized();

  if (!isCockroachTtlManaged('player_stats_cache')) {
    // Redis L1 handles TTL automatically - purge SQL L2 entries only when Cockroach TTL is unavailable.
    const statsResult = await sql`DELETE FROM player_stats_cache WHERE expires_at <= ${now}`.execute(db);
    const purgedStats = Number(statsResult.numAffectedRows ?? 0);
    if (purgedStats > 0) {
      logger.info(`[cache] purged ${purgedStats} expired player_stats_cache entries`);
    }
  }

  if (!isCockroachTtlManaged('ign_uuid_cache')) {
    const ignResult = await sql`DELETE FROM ign_uuid_cache WHERE expires_at <= ${now}`.execute(db);
    const purgedIgn = Number(ignResult.numAffectedRows ?? 0);
    if (purgedIgn > 0) {
      logger.info(`[cache] purged ${purgedIgn} expired ign_uuid_cache entries`);
    }
  }

  if (!isCockroachTtlManaged('player_query_history')) {
    const historyQuery = dbType === DatabaseType.POSTGRESQL
      ? "DELETE FROM player_query_history WHERE requested_at < NOW() - INTERVAL '30 days'"
      : "DELETE FROM player_query_history WHERE requested_at < DATEADD(day, -30, GETDATE())";

    const historyResult = await sql.raw(historyQuery).execute(db);
    const purgedHistory = Number(historyResult.numAffectedRows ?? 0);
    if (purgedHistory > 0) {
      logger.info(`[cache] purged ${purgedHistory} historical query entries older than 30 days`);
    }
  }

  const staleRateLimitThreshold = now - 60 * 60 * 1000;
  const rateLimitResult = await sql`DELETE FROM rate_limits WHERE window_start <= ${staleRateLimitThreshold}`.execute(db);
  const purgedBuckets = Number(rateLimitResult.numAffectedRows ?? 0);
  if (purgedBuckets > 0) {
    logger.info(`[cache] purged ${purgedBuckets} expired rate limit entries`);
  }

  if (!isCockroachTtlManaged('hypixel_api_calls')) {
    const hypixelCutoff = now - HYPIXEL_API_CALL_WINDOW_MS;
    const hypixelResult = await sql`DELETE FROM hypixel_api_calls WHERE called_at <= ${hypixelCutoff}`.execute(db);
    const purgedCalls = Number(hypixelResult.numAffectedRows ?? 0);
    if (purgedCalls > 0) {
      logger.info(`[cache] purged ${purgedCalls} expired hypixel_api_calls entries`);
    }
  }

  markDbAccess();
}

function mapRow<T>(row: CacheRow): CacheEntry<T> {
  const expiresAtRaw = row.expires_at;
  const expiresAt = typeof expiresAtRaw === 'string' ? Number.parseInt(expiresAtRaw, 10) : Number(expiresAtRaw);
  const lastModifiedRaw = row.last_modified;
  const lastModified =
    lastModifiedRaw === null
      ? null
      : typeof lastModifiedRaw === 'string'
        ? Number.parseInt(lastModifiedRaw, 10)
        : Number(lastModifiedRaw);

  let parsedPayload: unknown = row.payload;
  if (typeof row.payload === 'string') {
    parsedPayload = JSON.parse(row.payload);
  }

  const source = row.source as CacheSource | null;
  const validSource = source === 'hypixel' || source === 'community_verified' || source === 'community_unverified'
    ? source
    : null;

  return {
    value: parsedPayload as T,
    expiresAt,
    etag: row.etag,
    lastModified,
    source: validSource,
  };
}

export async function getCacheEntry<T>(key: string, includeExpired = false): Promise<CacheEntry<T> | null> {
  await ensureInitialized();

  // Try Redis first if available
  if (isRedisAvailable()) {
    const entry = await getPlayerCacheEntry<T>(key);
    if (entry) {
      recordCacheHit();
      return entry;
    }
  }

  // Fallback to SQL
  const result = await sql<CacheRow>`SELECT payload, expires_at, cached_at, etag, last_modified, source FROM player_stats_cache WHERE cache_key = ${key}`.execute(db);
  markDbAccess();
  const row = result.rows[0];
  if (!row) {
    recordCacheMiss('absent');
    return null;
  }

  let entry: CacheEntry<T>;
  try {
    entry = mapRow<T>(row);
  } catch (error) {
    recordCacheMiss('deserialization');
    return null;
  }
  const now = Date.now();
  if (Number.isNaN(entry.expiresAt) || entry.expiresAt <= now) {
    recordCacheMiss('expired');
    return includeExpired ? entry : null;
  }

  recordCacheHit();
  return entry;
}

export async function setCachedPayload<T>(
  key: string,
  value: T,
  ttlMs: number,
  metadata: CacheMetadata = {},
): Promise<void> {
  await ensureInitialized();

  // Use Redis if available
  if (isRedisAvailable()) {
    await setPlayerCacheEntry(key, value, ttlMs, metadata);
    return;
  }

  // Fallback to PostgreSQL
  const cachedAt = Date.now();
  const expiresAt = cachedAt + ttlMs;
  const payload = JSON.stringify(value);

  if (dbType === DatabaseType.POSTGRESQL) {
    await sql`INSERT INTO player_stats_cache (cache_key, payload, expires_at, cached_at, etag, last_modified, source)
       VALUES (${key}, ${payload}, ${expiresAt}, ${cachedAt}, ${metadata.etag ?? null}, ${metadata.lastModified ?? null}, ${metadata.source ?? null})
       ON CONFLICT (cache_key) DO UPDATE
       SET payload = EXCLUDED.payload,
           expires_at = EXCLUDED.expires_at,
           cached_at = EXCLUDED.cached_at,
           etag = EXCLUDED.etag,
           last_modified = EXCLUDED.last_modified,
           source = EXCLUDED.source`.execute(db);
  } else {
    await sql`MERGE player_stats_cache AS target
       USING (SELECT ${key} AS cache_key, ${payload} AS payload, ${expiresAt} AS expires_at, ${cachedAt} AS cached_at, ${metadata.etag ?? null} AS etag, ${metadata.lastModified ?? null} AS last_modified, ${metadata.source ?? null} AS source) AS source
       ON (target.cache_key = source.cache_key)
       WHEN MATCHED THEN
         UPDATE SET payload = source.payload,
                    expires_at = source.expires_at,
                    cached_at = source.cached_at,
                    etag = source.etag,
                    last_modified = source.last_modified,
                    source = source.source
       WHEN NOT MATCHED THEN
         INSERT (cache_key, payload, expires_at, cached_at, etag, last_modified, source)
         VALUES (source.cache_key, source.payload, source.expires_at, source.cached_at, source.etag, source.last_modified, source.source);`.execute(db);
  }
  markDbAccess();
}

export async function clearAllCacheEntries(): Promise<number> {
  await ensureInitialized();

  let deleted = 0;
  if (isRedisAvailable()) {
    deleted += await clearAllPlayerCacheEntries();
  }

  const statsResult = await sql`DELETE FROM player_stats_cache`.execute(db);
  const ignResult = await sql`DELETE FROM ign_uuid_cache`.execute(db);
  markDbAccess();
  return deleted + Number(statsResult.numAffectedRows ?? 0) + Number(ignResult.numAffectedRows ?? 0);
}

export async function deleteCacheEntries(keys: string[]): Promise<number> {
  if (keys.length === 0) {
    return 0;
  }

  await ensureInitialized();

  let deleted = 0;
  if (isRedisAvailable()) {
    deleted += await deletePlayerCacheEntries(keys);
  }

  let result;
  if (dbType === DatabaseType.POSTGRESQL) {
    result = await sql`DELETE FROM player_stats_cache WHERE cache_key = ANY(${keys})`.execute(db);
  } else {
    // SQL Server doesn't support ANY(${key}) with an array directly.
    const placeholders = keys.map((_, i) => `@p${i + 1}`).join(',');
    result = await sql`DELETE FROM player_stats_cache WHERE cache_key IN (${keys})`.execute(db);
  }
  markDbAccess();
  return deleted + Number(result.numAffectedRows ?? 0);
}

export async function closeCache(): Promise<void> {
  await db.destroy();
  logger.info('[cache] database closed');
}

export async function getActivePrivateUserCount(since: number): Promise<number> {
  await ensureInitialized();
  let result;
  if (dbType === DatabaseType.POSTGRESQL) {
    result = await sql<{ count: string }>`${since}`.execute(db);
  } else {
    result = await sql<{ count: number }>`${since}`.execute(db);
  }
  markDbAccess();
  const raw = result.rows[0]?.count ?? '0';
  const parsed = typeof raw === 'string' ? Number.parseInt(raw, 10) : Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function getPrivateRequestCount(since: number): Promise<number> {
  await ensureInitialized();
  let result;
  if (dbType === DatabaseType.POSTGRESQL) {
    result = await sql<{ total: string | number | null }>`${since}`.execute(db);
  } else {
    result = await sql<{ total: string | number | null }>`${since}`.execute(db);
  }
  markDbAccess();
  const raw = result.rows[0]?.total ?? '0';
  const parsed = typeof raw === 'string' ? Number.parseInt(raw, 10) : Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}
