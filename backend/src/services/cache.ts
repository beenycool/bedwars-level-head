import { HYPIXEL_API_CALL_WINDOW_MS, DATABASE_TYPE } from '../config';
import { recordCacheHit, recordCacheMiss } from './metrics';
import { database as pool } from './database/factory';
import { DatabaseType } from './database/adapter';

interface DatabaseError extends Error {
  code?: string | number;
  constraint?: string;
}

interface CacheRow {
  payload: unknown;
  expires_at: number | string;
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
      console.info('[cache] migrated rate_limits.count column to BIGINT');
    }
  }
}

const initialization = (async () => {
  if (pool.type === DatabaseType.POSTGRESQL) {
    await pool.query(
      `CREATE TABLE IF NOT EXISTS player_cache (
        cache_key TEXT PRIMARY KEY,
        payload JSONB NOT NULL,
        expires_at BIGINT NOT NULL,
        etag TEXT,
        last_modified BIGINT
      )`,
    );
  } else {
    await pool.query(
      `IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[player_cache]') AND type in (N'U'))
       CREATE TABLE player_cache (
         cache_key NVARCHAR(450) PRIMARY KEY,
         payload NVARCHAR(MAX) NOT NULL,
         expires_at BIGINT NOT NULL,
         etag NVARCHAR(MAX),
         last_modified BIGINT
       )`,
    );
  }

  console.info('[cache] player_cache table is ready');

  await ensureRateLimitTable();
  console.info('[cache] rate_limits table is ready');

  const alterStatements: Array<{ column: string; pgQuery: string; msQuery: string }> = [
    { 
      column: 'etag', 
      pgQuery: 'ALTER TABLE player_cache ADD COLUMN IF NOT EXISTS etag TEXT',
      msQuery: "IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[player_cache]') AND name = 'etag') ALTER TABLE player_cache ADD etag NVARCHAR(MAX)"
    },
    {
      column: 'last_modified',
      pgQuery: 'ALTER TABLE player_cache ADD COLUMN IF NOT EXISTS last_modified BIGINT',
      msQuery: "IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[player_cache]') AND name = 'last_modified') ALTER TABLE player_cache ADD last_modified BIGINT"
    },
    {
      column: 'source',
      pgQuery: 'ALTER TABLE player_cache ADD COLUMN IF NOT EXISTS source TEXT',
      msQuery: "IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[player_cache]') AND name = 'source') ALTER TABLE player_cache ADD source NVARCHAR(MAX)"
    },
  ];

  for (const { column, pgQuery, msQuery } of alterStatements) {
    try {
      await pool.query(pool.type === DatabaseType.POSTGRESQL ? pgQuery : msQuery);
    } catch (error) {
      const dbError = error as DatabaseError | undefined;
      if (dbError?.code === '42701' || dbError?.code === 2705) {
        console.info(`[cache] column ${column} already exists (concurrent migration handled)`);
        continue;
      }
      console.error(`[cache] failed to ensure column ${column} exists`, error);
      throw error;
    }
  }

  if (pool.type === DatabaseType.POSTGRESQL) {
    await pool.query(
      `CREATE TABLE IF NOT EXISTS hypixel_api_calls (
        id BIGSERIAL PRIMARY KEY,
        called_at BIGINT NOT NULL,
        uuid TEXT NOT NULL
      )`,
    );
    await pool.query('CREATE INDEX IF NOT EXISTS idx_hypixel_calls_time ON hypixel_api_calls (called_at)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_player_cache_expires ON player_cache (expires_at)');
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
    await pool.query("IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'idx_player_cache_expires') CREATE INDEX idx_player_cache_expires ON player_cache (expires_at)");
    await pool.query("IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'idx_rate_limits_window') CREATE INDEX idx_rate_limits_window ON rate_limits (window_start)");
  }
  
  console.info('[cache] hypixel_api_calls table is ready');
})();

export async function ensureInitialized(): Promise<void> {
  await initialization;
}

export async function purgeExpiredEntries(now: number = Date.now()): Promise<void> {
  await ensureInitialized();
  const result = await pool.query('DELETE FROM player_cache WHERE expires_at <= $1', [now]);
  const purged = result.rowCount;
  if (purged > 0) {
    console.info(`[cache] purged ${purged} expired entries`);
  }

  const historyQuery = pool.type === DatabaseType.POSTGRESQL
    ? "DELETE FROM player_query_history WHERE requested_at < NOW() - INTERVAL '30 days'"
    : "DELETE FROM player_query_history WHERE requested_at < DATEADD(day, -30, GETDATE())";
  
  const historyResult = await pool.query(historyQuery);
  const purgedHistory = historyResult.rowCount;
  if (purgedHistory > 0) {
    console.info(`[cache] purged ${purgedHistory} historical query entries older than 30 days`);
  }

  const staleRateLimitThreshold = now - 60 * 60 * 1000;
  const rateLimitResult = await pool.query('DELETE FROM rate_limits WHERE window_start <= $1', [
    staleRateLimitThreshold,
  ]);
  const purgedBuckets = rateLimitResult.rowCount;
  if (purgedBuckets > 0) {
    console.info(`[cache] purged ${purgedBuckets} expired rate limit entries`);
  }
  const hypixelCutoff = now - HYPIXEL_API_CALL_WINDOW_MS;
  const hypixelResult = await pool.query('DELETE FROM hypixel_api_calls WHERE called_at <= $1', [
    hypixelCutoff,
  ]);
  const purgedCalls = hypixelResult.rowCount;
  if (purgedCalls > 0) {
    console.info(`[cache] purged ${purgedCalls} expired hypixel_api_calls entries`);
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
  const result = await pool.query<CacheRow>(
    'SELECT payload, expires_at, etag, last_modified, source FROM player_cache WHERE cache_key = $1',
    [key],
  );
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
      await pool.query('DELETE FROM player_cache WHERE cache_key = $1', [key]);
    }
    recordCacheMiss('deserialization');
    return null;
  }
  const now = Date.now();
  if (Number.isNaN(entry.expiresAt) || entry.expiresAt <= now) {
    if (!includeExpired) {
      await pool.query('DELETE FROM player_cache WHERE cache_key = $1', [key]);
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
  const expiresAt = Date.now() + ttlMs;
  const payload = JSON.stringify(value);

  if (pool.type === DatabaseType.POSTGRESQL) {
    await pool.query(
      `INSERT INTO player_cache (cache_key, payload, expires_at, etag, last_modified, source)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (cache_key) DO UPDATE
       SET payload = EXCLUDED.payload,
           expires_at = EXCLUDED.expires_at,
           etag = EXCLUDED.etag,
           last_modified = EXCLUDED.last_modified,
           source = EXCLUDED.source`,
      [key, payload, expiresAt, metadata.etag ?? null, metadata.lastModified ?? null, metadata.source ?? null],
    );
  } else {
    await pool.query(
      `MERGE player_cache AS target
       USING (SELECT $1 AS cache_key, $2 AS payload, $3 AS expires_at, $4 AS etag, $5 AS last_modified, $6 AS source) AS source
       ON (target.cache_key = source.cache_key)
       WHEN MATCHED THEN
         UPDATE SET payload = source.payload,
                    expires_at = source.expires_at,
                    etag = source.etag,
                    last_modified = source.last_modified,
                    source = source.source
       WHEN NOT MATCHED THEN
         INSERT (cache_key, payload, expires_at, etag, last_modified, source)
         VALUES (source.cache_key, source.payload, source.expires_at, source.etag, source.last_modified, source.source);`,
      [key, payload, expiresAt, metadata.etag ?? null, metadata.lastModified ?? null, metadata.source ?? null],
    );
  }
}

export async function clearAllCacheEntries(): Promise<number> {
  await ensureInitialized();
  const result = await pool.query('DELETE FROM player_cache');
  return result.rowCount;
}

export async function deleteCacheEntries(keys: string[]): Promise<number> {
  if (keys.length === 0) {
    return 0;
  }

  await ensureInitialized();
  let result;
  if (pool.type === DatabaseType.POSTGRESQL) {
    result = await pool.query('DELETE FROM player_cache WHERE cache_key = ANY($1)', [keys]);
  } else {
    // SQL Server doesn't support ANY($1) with an array directly.
    // For simplicity, we'll use a series of ORs or an IN clause with multiple parameters
    // If keys is large, this might be slow, but for normal usage it's fine.
    const placeholders = keys.map((_, i) => `@p${i + 1}`).join(',');
    result = await pool.query(`DELETE FROM player_cache WHERE cache_key IN (${placeholders})`, keys);
  }
  return result.rowCount;
}

export async function closeCache(): Promise<void> {
  await pool.close();
  console.info('[cache] database closed');
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
  const raw = result.rows[0]?.total ?? '0';
  const parsed = typeof raw === 'string' ? Number.parseInt(raw, 10) : Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}
