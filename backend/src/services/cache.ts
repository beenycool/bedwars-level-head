import { Pool } from 'pg';
import { CACHE_DB_URL, CACHE_DB_POOL_MAX, CACHE_DB_POOL_MIN } from '../config';
import { recordCacheHit, recordCacheMiss } from './metrics';

interface CacheRow {
  payload: string;
  expires_at: number | string;
  etag: string | null;
  last_modified: number | string | null;
}

export interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  etag: string | null;
  lastModified: number | null;
}

export interface CacheMetadata {
  etag?: string | null;
  lastModified?: number | null;
}

export const pool = new Pool({
  connectionString: CACHE_DB_URL,
  min: CACHE_DB_POOL_MIN,
  max: CACHE_DB_POOL_MAX,
});

const initialization = pool
  .query(
    `CREATE TABLE IF NOT EXISTS player_cache (
      cache_key TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      expires_at BIGINT NOT NULL,
      etag TEXT,
      last_modified BIGINT
    )`,
  )
  .then(async () => {
    await pool.query('ALTER TABLE player_cache ADD COLUMN IF NOT EXISTS etag TEXT');
    await pool.query('ALTER TABLE player_cache ADD COLUMN IF NOT EXISTS last_modified BIGINT');
  })
  .catch((error: unknown) => {
    console.error('Failed to initialize cache table', error);
    throw error;
  });

async function ensureInitialized(): Promise<void> {
  await initialization;
}

export async function purgeExpiredEntries(now: number = Date.now()): Promise<void> {
  await ensureInitialized();
  await pool.query('DELETE FROM player_cache WHERE expires_at <= $1', [now]);
}

function mapRow<T>(row: CacheRow): CacheEntry<T> {
  const expiresAtRaw = row.expires_at;
  const expiresAt = typeof expiresAtRaw === 'string' ? Number.parseInt(expiresAtRaw, 10) : expiresAtRaw;
  const lastModifiedRaw = row.last_modified;
  const lastModified =
    lastModifiedRaw === null
      ? null
      : typeof lastModifiedRaw === 'string'
        ? Number.parseInt(lastModifiedRaw, 10)
        : lastModifiedRaw;

  return {
    value: JSON.parse(row.payload) as T,
    expiresAt,
    etag: row.etag,
    lastModified,
  };
}

export async function getCacheEntry<T>(key: string, includeExpired = false): Promise<CacheEntry<T> | null> {
  await ensureInitialized();
  const result = await pool.query<CacheRow>(
    'SELECT payload, expires_at, etag, last_modified FROM player_cache WHERE cache_key = $1',
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
  await pool.query(
    `INSERT INTO player_cache (cache_key, payload, expires_at, etag, last_modified)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (cache_key) DO UPDATE
     SET payload = EXCLUDED.payload,
         expires_at = EXCLUDED.expires_at,
         etag = EXCLUDED.etag,
         last_modified = EXCLUDED.last_modified`,
    [key, payload, expiresAt, metadata.etag ?? null, metadata.lastModified ?? null],
  );
}

export async function clearAllCacheEntries(): Promise<number> {
  await ensureInitialized();
  const result = await pool.query('DELETE FROM player_cache');
  return result.rowCount ?? 0;
}

export async function deleteCacheEntries(keys: string[]): Promise<number> {
  if (keys.length === 0) {
    return 0;
  }

  await ensureInitialized();
  const result = await pool.query('DELETE FROM player_cache WHERE cache_key = ANY($1)', [keys]);
  return result.rowCount ?? 0;
}

export async function closeCache(): Promise<void> {
  await ensureInitialized();
  await pool.end();
}
