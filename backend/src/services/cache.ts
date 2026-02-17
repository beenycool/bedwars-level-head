import { CACHE_DB_ALLOW_COLD_READS, CACHE_DB_WARM_WINDOW_MS, HYPIXEL_API_CALL_WINDOW_MS } from '../config';
import { recordCacheHit, recordCacheMiss } from './metrics';
import { database as pool } from './database/factory';
import { DatabaseType } from './database/adapter';
import {
    getPlayerCacheEntry,
    setPlayerCacheEntry,
    clearAllPlayerCacheEntries,
    deletePlayerCacheEntries,
    isRedisAvailable,
} from './redis';

interface DatabaseError extends Error { code?: string | number; constraint?: string; }
interface CacheRow { payload: unknown; expires_at: number | string; cached_at?: number | string | null; etag: string | null; last_modified: number | string | null; source: string | null; }
export type CacheSource = 'hypixel' | 'community_verified' | 'community_unverified';
export interface CacheEntry<T> { value: T; expiresAt: number; etag: string | null; lastModified: number | null; source: CacheSource | null; }
export interface CacheMetadata { etag?: string | null; lastModified?: number | null; source?: CacheSource | null; }

let lastDbAccessAt = 0;
export function markDbAccess(): void { lastDbAccessAt = Date.now(); }
export function shouldReadFromDb(): boolean {
  if (CACHE_DB_ALLOW_COLD_READS) return true;
  if (CACHE_DB_WARM_WINDOW_MS <= 0) return false;
  if (lastDbAccessAt === 0) { lastDbAccessAt = Date.now(); return true; }
  return Date.now() - lastDbAccessAt < CACHE_DB_WARM_WINDOW_MS;
}
export { pool };

async function ensureRateLimitTable(): Promise<void> {
  try {
    const cols = pool.type === DatabaseType.POSTGRESQL
      ? 'key TEXT PRIMARY KEY, count BIGINT NOT NULL, window_start BIGINT NOT NULL'
      : '[key] NVARCHAR(450) PRIMARY KEY, [count] BIGINT NOT NULL, window_start BIGINT NOT NULL';
    await pool.query(pool.getCreateTableIfNotExistsSql('rate_limits', cols));
  } catch (error) {
    const e = error as DatabaseError; if (e?.code !== '42P07' && e?.code !== 2714) throw error;
  }
  if (pool.type === DatabaseType.POSTGRESQL) {
    const res = await pool.query<{ data_type: string }>(`SELECT data_type FROM information_schema.columns WHERE table_name = 'rate_limits' AND table_schema = current_schema() AND column_name = 'count'`);
    if (res.rows[0]?.data_type?.toLowerCase() !== 'bigint') {
      await pool.query('ALTER TABLE rate_limits ALTER COLUMN count TYPE BIGINT USING count::BIGINT');
      console.info('[cache] migrated rate_limits.count to BIGINT');
    }
  }
}

async function ensurePlayerStatsTables(): Promise<void> {
  const statsCols = pool.type === DatabaseType.POSTGRESQL
    ? `cache_key TEXT PRIMARY KEY, payload JSONB NOT NULL, expires_at BIGINT NOT NULL, cached_at BIGINT, etag TEXT, last_modified BIGINT, source TEXT DEFAULT 'hypixel', created_at TIMESTAMPTZ DEFAULT NOW()`
    : `cache_key NVARCHAR(450) PRIMARY KEY, payload NVARCHAR(MAX) NOT NULL, expires_at BIGINT NOT NULL, cached_at BIGINT NULL, etag NVARCHAR(255), last_modified BIGINT, source NVARCHAR(64), created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()`;
  await pool.query(pool.getCreateTableIfNotExistsSql('player_stats_cache', statsCols));
  if (pool.type === DatabaseType.POSTGRESQL) await pool.query('ALTER TABLE player_stats_cache ADD COLUMN IF NOT EXISTS cached_at BIGINT');
  else await pool.query(`IF COL_LENGTH('player_stats_cache', 'cached_at') IS NULL ALTER TABLE player_stats_cache ADD cached_at BIGINT`);
  await pool.query(pool.getCreateIndexIfNotExistsSql('idx_player_stats_expires', 'player_stats_cache', 'expires_at'));

  const ignCols = pool.type === DatabaseType.POSTGRESQL
    ? `ign TEXT PRIMARY KEY, uuid TEXT, nicked BOOLEAN NOT NULL DEFAULT FALSE, expires_at BIGINT NOT NULL, updated_at TIMESTAMPTZ DEFAULT NOW()`
    : `ign NVARCHAR(32) PRIMARY KEY, uuid NVARCHAR(32), nicked BIT NOT NULL DEFAULT 0, expires_at BIGINT NOT NULL, updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()`;
  await pool.query(pool.getCreateTableIfNotExistsSql('ign_uuid_cache', ignCols));
  await pool.query(pool.getCreateIndexIfNotExistsSql('idx_ign_uuid_expires', 'ign_uuid_cache', 'expires_at'));
}

const initialization = (async () => {
  console.info('[cache] player cache: Redis L1 + SQL L2');
  await ensureRateLimitTable(); await ensurePlayerStatsTables();
  const apiCols = pool.type === DatabaseType.POSTGRESQL
    ? 'id BIGSERIAL PRIMARY KEY, called_at BIGINT NOT NULL, uuid TEXT NOT NULL'
    : 'id BIGINT IDENTITY(1,1) PRIMARY KEY, called_at BIGINT NOT NULL, uuid NVARCHAR(MAX) NOT NULL';
  await pool.query(pool.getCreateTableIfNotExistsSql('hypixel_api_calls', apiCols));
  await pool.query(pool.getCreateIndexIfNotExistsSql('idx_hypixel_calls_time', 'hypixel_api_calls', 'called_at'));
  await pool.query(pool.getCreateIndexIfNotExistsSql('idx_rate_limits_window', 'rate_limits', 'window_start'));
  console.info('[cache] tables ready');
})();

export async function ensureInitialized(): Promise<void> { await initialization; }

export async function purgeExpiredEntries(now: number = Date.now()): Promise<void> {
  await ensureInitialized();
  const p1 = pool.getPlaceholder(1);
  const sRes = await pool.query(`DELETE FROM player_stats_cache WHERE expires_at <= ${p1}`, [now]);
  if (sRes.rowCount > 0) console.info(`[cache] purged ${sRes.rowCount} stats`);
  const iRes = await pool.query(`DELETE FROM ign_uuid_cache WHERE expires_at <= ${p1}`, [now]);
  if (iRes.rowCount > 0) console.info(`[cache] purged ${iRes.rowCount} igns`);
  markDbAccess();
  const hRes = await pool.query(`DELETE FROM player_query_history WHERE requested_at < ${pool.getDateMinusIntervalSql(30, 'day')}`);
  if (hRes.rowCount > 0) console.info(`[cache] purged ${hRes.rowCount} history`);
  const rRes = await pool.query(`DELETE FROM rate_limits WHERE window_start <= ${p1}`, [now - 3600000]);
  if (rRes.rowCount > 0) console.info(`[cache] purged ${rRes.rowCount} rate limits`);
  const hApiRes = await pool.query(`DELETE FROM hypixel_api_calls WHERE called_at <= ${p1}`, [now - HYPIXEL_API_CALL_WINDOW_MS]);
  if (hApiRes.rowCount > 0) console.info(`[cache] purged ${hApiRes.rowCount} api calls`);
}

function mapRow<T>(row: CacheRow): CacheEntry<T> {
  const expiresAt = Number(row.expires_at);
  const lastModified = row.last_modified === null ? null : Number(row.last_modified);
  let payload: unknown = row.payload; if (typeof payload === 'string') payload = JSON.parse(payload);
  const source = row.source as CacheSource | null;
  const validSource = (source === 'hypixel' || source === 'community_verified' || source === 'community_unverified') ? source : null;
  return { value: payload as T, expiresAt, etag: row.etag, lastModified, source: validSource };
}

export async function getCacheEntry<T>(key: string, includeExpired = false): Promise<CacheEntry<T> | null> {
  await ensureInitialized();
  if (isRedisAvailable()) {
    const entry = await getPlayerCacheEntry<T>(key); if (entry) { recordCacheHit(); return entry; }
  }
  const p1 = pool.getPlaceholder(1);
  const res = await pool.query<CacheRow>(`SELECT payload, expires_at, cached_at, etag, last_modified, source FROM player_stats_cache WHERE cache_key = ${p1}`, [key]);
  markDbAccess(); const row = res.rows[0]; if (!row) { recordCacheMiss('absent'); return null; }
  let entry: CacheEntry<T>;
  try { entry = mapRow<T>(row); } catch (e) {
    if (!includeExpired) await pool.query(`DELETE FROM player_stats_cache WHERE cache_key = ${p1}`, [key]);
    recordCacheMiss('deserialization'); return null;
  }
  if (entry.expiresAt <= Date.now()) {
    if (!includeExpired) await pool.query(`DELETE FROM player_stats_cache WHERE cache_key = ${p1}`, [key]);
    recordCacheMiss('expired'); return includeExpired ? entry : null;
  }
  recordCacheHit(); return entry;
}

export async function setCachedPayload<T>(key: string, value: T, ttlMs: number, metadata: CacheMetadata = {}): Promise<void> {
  await ensureInitialized();
  if (isRedisAvailable()) { await setPlayerCacheEntry(key, value, ttlMs, metadata); return; }
  const cachedAt = Date.now(); const expiresAt = cachedAt + ttlMs; const payload = JSON.stringify(value);
  const columns = ['cache_key', 'payload', 'expires_at', 'cached_at', 'etag', 'last_modified', 'source'];
  const updates = ['payload', 'expires_at', 'cached_at', 'etag', 'last_modified', 'source'];
  await pool.query(pool.getUpsertSql('player_stats_cache', columns, 'cache_key', updates), [key, payload, expiresAt, cachedAt, metadata.etag ?? null, metadata.lastModified ?? null, metadata.source ?? null]);
  markDbAccess();
}

export async function clearAllCacheEntries(): Promise<number> {
  await ensureInitialized();
  let deleted = isRedisAvailable() ? await clearAllPlayerCacheEntries() : 0;
  const sRes = await pool.query('DELETE FROM player_stats_cache');
  const iRes = await pool.query('DELETE FROM ign_uuid_cache');
  markDbAccess(); return deleted + sRes.rowCount + iRes.rowCount;
}

export async function deleteCacheEntries(keys: string[]): Promise<number> {
  if (keys.length === 0) return 0;
  await ensureInitialized();
  let deleted = isRedisAvailable() ? await deletePlayerCacheEntries(keys) : 0;
  const placeholders = keys.map((_, i) => pool.getPlaceholder(i + 1));
  const res = await pool.query(`DELETE FROM player_stats_cache WHERE ${pool.getArrayInSql('cache_key', placeholders)}`, keys);
  markDbAccess(); return deleted + res.rowCount;
}

export async function closeCache(): Promise<void> { await pool.close(); console.info('[cache] database closed'); }

export async function getActivePrivateUserCount(since: number): Promise<number> {
  await ensureInitialized();
  const res = await pool.query<{ count: string | number }>(`SELECT COUNT(DISTINCT ${pool.getSubstringAfterSql('key', ':')}) AS count FROM rate_limits WHERE key LIKE 'private:%' AND window_start >= ${pool.getPlaceholder(1)}`, [since]);
  markDbAccess(); const raw = res.rows[0]?.count ?? '0';
  return typeof raw === 'string' ? Number.parseInt(raw, 10) : Number(raw);
}

export async function getPrivateRequestCount(since: number): Promise<number> {
  await ensureInitialized();
  const res = await pool.query<{ total: string | number | null }>(`SELECT COALESCE(SUM(count), 0) AS total FROM rate_limits WHERE key LIKE 'private:%' AND window_start >= ${pool.getPlaceholder(1)}`, [since]);
  markDbAccess(); const raw = res.rows[0]?.total ?? '0';
  return typeof raw === 'string' ? Number.parseInt(raw, 10) : Number(raw);
}
