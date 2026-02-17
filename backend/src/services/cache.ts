import { CACHE_DB_ALLOW_COLD_READS, CACHE_DB_WARM_WINDOW_MS, HYPIXEL_API_CALL_WINDOW_MS } from '../config';
import { recordCacheHit, recordCacheMiss } from './metrics';
import { database as pool } from './database/factory';
import { DatabaseType } from './database/adapter';
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
export { pool };

async function ensureRateLimitTable(): Promise<void> {
  try {
    if (pool.type === DatabaseType.POSTGRESQL) {
      await pool.query(
        `CREATE TABLE IF NOT EXISTS rate_limits (
          key TEXT PRIMARY KEY,
          count BIGINT NOT NULL,
          window_start BIGINT NOT NULL
        )`,
      );
    } else {
      await pool.query(
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

  if (pool.type === DatabaseType.POSTGRESQL) {
    const columnInfo = await pool.query<{ data_type: string }>(
      `SELECT data_type FROM information_schema.columns
       WHERE table_name = 'rate_limits' AND table_schema = current_schema() AND column_name = 'count'`,
    );
    const dataType = columnInfo.rows[0]?.data_type;
    if (dataType && dataType.toLowerCase() !== 'bigint') {
      await pool.query('ALTER TABLE rate_limits ALTER COLUMN count TYPE BIGINT USING count::BIGINT');
      logger.info('[cache] migrated rate_limits.count column to BIGINT');
    }
  }
}

async function ensurePlayerStatsTables(): Promise<void> {
  if (pool.type === DatabaseType.POSTGRESQL) {
    await pool.query(
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
    await pool.query('ALTER TABLE player_stats_cache ADD COLUMN IF NOT EXISTS cached_at BIGINT');
    await pool.query(
      `CREATE INDEX IF NOT EXISTS idx_player_stats_expires ON player_stats_cache (expires_at)`,
    );

    await pool.query(
      `CREATE TABLE IF NOT EXISTS ign_uuid_cache (
        ign TEXT PRIMARY KEY,
        uuid TEXT,
        nicked BOOLEAN NOT NULL DEFAULT FALSE,
        expires_at BIGINT NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`,
    );
    await pool.query(
      `CREATE INDEX IF NOT EXISTS idx_ign_uuid_expires ON ign_uuid_cache (expires_at)`,
    );
  } else {
    await pool.query(
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
    await pool.query(
      `IF COL_LENGTH('player_stats_cache', 'cached_at') IS NULL
       ALTER TABLE player_stats_cache ADD cached_at BIGINT`,
    );
    await pool.query(
      "IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'idx_player_stats_expires') CREATE INDEX idx_player_stats_expires ON player_stats_cache (expires_at)",
    );

    await pool.query(
      `IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[ign_uuid_cache]') AND type in (N'U'))
       CREATE TABLE ign_uuid_cache (
         ign NVARCHAR(32) PRIMARY KEY,
         uuid NVARCHAR(32),
         nicked BIT NOT NULL DEFAULT 0,
         expires_at BIGINT NOT NULL,
         updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
       )`,
    );
    await pool.query(
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

  if (pool.type === DatabaseType.POSTGRESQL) {
    await pool.query(
      `CREATE TABLE IF NOT EXISTS hypixel_api_calls (
        id BIGSERIAL PRIMARY KEY,
        called_at BIGINT NOT NULL,
        uuid TEXT NOT NULL
      )`,
    );
    await pool.query('CREATE INDEX IF NOT EXISTS idx_hypixel_calls_time ON hypixel_api_calls (called_at)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_rate_limits_window ON rate_limits (window_start)');
  } else {
    await pool.query(
      `IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[hypixel_api_calls]') AND type in (N'U'))
       CREATE TABLE hypixel_api_calls (
         id BIGINT IDENTITY(1,1) PRIMARY KEY,
         called_at BIGINT NOT NULL,
         uuid NVARCHAR(MAX) NOT NULL
       )`,
    );
    await pool.query("IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'idx_hypixel_calls_time') CREATE INDEX idx_hypixel_calls_time ON hypixel_api_calls (called_at)");
    await pool.query("IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'idx_rate_limits_window') CREATE INDEX idx_rate_limits_window ON rate_limits (window_start)");
  }

  logger.info('[cache] hypixel_api_calls table is ready');
})();

export async function ensureInitialized(): Promise<void> {
  await initialization;
}

export async function purgeExpiredEntries(now: number = Date.now()): Promise<void> {
  await ensureInitialized();

  // Redis L1 handles TTL automatically - purge SQL L2 entries only
  const statsResult = await pool.query('DELETE FROM player_stats_cache WHERE expires_at <= $1', [now]);
  const purgedStats = statsResult.rowCount;
  if (purgedStats > 0) {
    logger.info(`[cache] purged ${purgedStats} expired player_stats_cache entries`);
  }

  const ignResult = await pool.query('DELETE FROM ign_uuid_cache WHERE expires_at <= $1', [now]);
  const purgedIgn = ignResult.rowCount;
  if (purgedIgn > 0) {
    logger.info(`[cache] purged ${purgedIgn} expired ign_uuid_cache entries`);
  }
  markDbAccess();

  const historyQuery = pool.type === DatabaseType.POSTGRESQL
    ? "DELETE FROM player_query_history WHERE requested_at < NOW() - INTERVAL '30 days'"
    : "DELETE FROM player_query_history WHERE requested_at < DATEADD(day, -30, GETDATE())";

  const historyResult = await pool.query(historyQuery);
  const purgedHistory = historyResult.rowCount;
  if (purgedHistory > 0) {
    logger.info(`[cache] purged ${purgedHistory} historical query entries older than 30 days`);
  }

  const staleRateLimitThreshold = now - 60 * 60 * 1000;
  const rateLimitResult = await pool.query('DELETE FROM rate_limits WHERE window_start <= $1', [
    staleRateLimitThreshold,
  ]);
  const purgedBuckets = rateLimitResult.rowCount;
  if (purgedBuckets > 0) {
    logger.info(`[cache] purged ${purgedBuckets} expired rate limit entries`);
  }
  const hypixelCutoff = now - HYPIXEL_API_CALL_WINDOW_MS;
  const hypixelResult = await pool.query('DELETE FROM hypixel_api_calls WHERE called_at <= $1', [
    hypixelCutoff,
  ]);
  const purgedCalls = hypixelResult.rowCount;
  if (purgedCalls > 0) {
    logger.info(`[cache] purged ${purgedCalls} expired hypixel_api_calls entries`);
  }
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
  const result = await pool.query<CacheRow>(
    'SELECT payload, expires_at, cached_at, etag, last_modified, source FROM player_stats_cache WHERE cache_key = $1',
    [key],
  );
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
    if (!includeExpired) {
      await pool.query('DELETE FROM player_stats_cache WHERE cache_key = $1', [key]);
    }
    recordCacheMiss('deserialization');
    return null;
  }
  const now = Date.now();
  if (Number.isNaN(entry.expiresAt) || entry.expiresAt <= now) {
    if (!includeExpired) {
      await pool.query('DELETE FROM player_stats_cache WHERE cache_key = $1', [key]);
    }
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

  if (pool.type === DatabaseType.POSTGRESQL) {
    await pool.query(
      `INSERT INTO player_stats_cache (cache_key, payload, expires_at, cached_at, etag, last_modified, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (cache_key) DO UPDATE
       SET payload = EXCLUDED.payload,
           expires_at = EXCLUDED.expires_at,
           cached_at = EXCLUDED.cached_at,
           etag = EXCLUDED.etag,
           last_modified = EXCLUDED.last_modified,
           source = EXCLUDED.source`,
      [key, payload, expiresAt, cachedAt, metadata.etag ?? null, metadata.lastModified ?? null, metadata.source ?? null],
    );
  } else {
    await pool.query(
      `MERGE player_stats_cache AS target
       USING (SELECT $1 AS cache_key, $2 AS payload, $3 AS expires_at, $4 AS cached_at, $5 AS etag, $6 AS last_modified, $7 AS source) AS source
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
         VALUES (source.cache_key, source.payload, source.expires_at, source.cached_at, source.etag, source.last_modified, source.source);`,
      [key, payload, expiresAt, cachedAt, metadata.etag ?? null, metadata.lastModified ?? null, metadata.source ?? null],
    );
  }
  markDbAccess();
}

export async function clearAllCacheEntries(): Promise<number> {
  await ensureInitialized();

  let deleted = 0;
  if (isRedisAvailable()) {
    deleted += await clearAllPlayerCacheEntries();
  }

  const statsResult = await pool.query('DELETE FROM player_stats_cache');
  const ignResult = await pool.query('DELETE FROM ign_uuid_cache');
  markDbAccess();
  return deleted + statsResult.rowCount + ignResult.rowCount;
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
  if (pool.type === DatabaseType.POSTGRESQL) {
    result = await pool.query('DELETE FROM player_stats_cache WHERE cache_key = ANY($1)', [keys]);
  } else {
    // SQL Server doesn't support ANY($1) with an array directly.
    const placeholders = keys.map((_, i) => `@p${i + 1}`).join(',');
    result = await pool.query(`DELETE FROM player_stats_cache WHERE cache_key IN (${placeholders})`, keys);
  }
  markDbAccess();
  return deleted + result.rowCount;
}

export async function closeCache(): Promise<void> {
  await pool.close();
  logger.info('[cache] database closed');
}

export async function getActivePrivateUserCount(since: number): Promise<number> {
  await ensureInitialized();
  let result;
  if (pool.type === DatabaseType.POSTGRESQL) {
    result = await pool.query<{ count: string }>(
      `
      SELECT COUNT(DISTINCT split_part(key, ':', 2)) AS count
      FROM rate_limits
      WHERE key LIKE 'private:%' AND window_start >= $1
      `,
      [since],
    );
  } else {
    result = await pool.query<{ count: number }>(
      `
      SELECT COUNT(DISTINCT SUBSTRING([key], CHARINDEX(':', [key]) + 1, LEN([key]))) AS count
      FROM rate_limits
      WHERE [key] LIKE 'private:%' AND window_start >= $1
      `,
      [since],
    );
  }
  markDbAccess();
  const raw = result.rows[0]?.count ?? '0';
  const parsed = typeof raw === 'string' ? Number.parseInt(raw, 10) : Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function getPrivateRequestCount(since: number): Promise<number> {
  await ensureInitialized();
  let result;
  if (pool.type === DatabaseType.POSTGRESQL) {
    result = await pool.query<{ total: string | number | null }>(
      `
      SELECT COALESCE(SUM(count), 0) AS total
      FROM rate_limits
      WHERE key LIKE 'private:%' AND window_start >= $1
      `,
      [since],
    );
  } else {
    result = await pool.query<{ total: string | number | null }>(
      `
      SELECT COALESCE(SUM(count), 0) AS total
      FROM rate_limits
      WHERE [key] LIKE 'private:%' AND window_start >= $1
      `,
      [since],
    );
  }
  markDbAccess();
  const raw = result.rows[0]?.total ?? '0';
  const parsed = typeof raw === 'string' ? Number.parseInt(raw, 10) : Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}
