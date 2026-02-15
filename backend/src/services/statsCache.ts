import {
  IGN_L2_TTL_MS,
  PLAYER_L1_INFO_REFRESH_MS,
  PLAYER_L1_SAFETY_FACTOR,
  PLAYER_L1_TARGET_UTILIZATION,
  PLAYER_L1_TTL_FALLBACK_MS,
  PLAYER_L1_TTL_MAX_MS,
  PLAYER_L1_TTL_MIN_MS,
  PLAYER_L2_TTL_MS,
  REDIS_CACHE_MAX_BYTES,
  SWR_ENABLED,
  SWR_STALE_TTL_MS,
} from '../config';
import { CacheEntry, CacheMetadata, CacheSource, ensureInitialized, markDbAccess, pool, shouldReadFromDb } from './cache';
import { DatabaseType } from './database/adapter';
import { recordCacheHit, recordCacheMiss, recordCacheTierHit, recordCacheTierMiss, recordCacheSourceHit, recordCacheRefresh } from './metrics';
import { fetchHypixelPlayer, HypixelFetchOptions, MinimalPlayerStats, extractMinimalStats } from './hypixel';
import { getRedisClient, isRedisAvailable } from './redis';

// Single-flight pattern: dedupe concurrent upstream fetches for the same UUID
// Prevents cache stampede (thundering herd) when multiple requests hit a cache miss
const fetchingLocks: Map<string, Promise<FetchResult>> = new Map();
const backgroundRefreshLocks: Map<string, Promise<void>> = new Map();

const PLAYER_KEY_PREFIX = 'player:';
const IGN_MAPPING_PREFIX = 'ignmap:';

/**
 * Fetch result with stats and metadata for cache storage
 */
interface FetchResult {
  stats: MinimalPlayerStats;
  etag: string | null;
  lastModified: number | null;
}

/**
 * Fetch player stats from Hypixel with single-flight deduplication.
 * Prevents cache stampede by ensuring only one upstream request is in flight
 * for a given UUID at any time. All concurrent callers wait for the same promise.
 */
export async function fetchWithDedupe(
  uuid: string,
  options?: HypixelFetchOptions,
): Promise<FetchResult> {
  const normalizedUuid = uuid.toLowerCase();

  // Check if already fetching for this UUID
  const existing = fetchingLocks.get(normalizedUuid);
  if (existing) {
    // Return the existing promise - all waiters get the same result
    return await existing;
  }

  // Create new fetch promise that includes the full result with metadata
  const fetchPromise: Promise<FetchResult> = (async (): Promise<FetchResult> => {
    const result = await fetchHypixelPlayer(normalizedUuid, options);

    if (result.notModified) {
      // Should not happen when called from cache miss, but handle gracefully
      throw new Error('Unexpected 304 from Hypixel during cache miss');
    }

    if (!result.payload) {
      throw new Error('Empty payload from Hypixel');
    }

    return {
      stats: extractMinimalStats(result.payload),
      etag: result.etag,
      lastModified: result.lastModified,
    };
  })();

  // Store the promise so concurrent callers can wait for it
  fetchingLocks.set(normalizedUuid, fetchPromise);

  try {
    return await fetchPromise;
  } finally {
    // Clean up lock regardless of success or failure
    fetchingLocks.delete(normalizedUuid);
  }
}

interface CacheRow {
  payload: unknown;
  expires_at: number | string;
  cached_at?: number | string | null;
  etag: string | null;
  last_modified: number | string | null;
  source: string | null;
}

interface IgnCacheRow {
  uuid: string | null;
  nicked: boolean | number;
  expires_at: number | string;
}

interface RedisIgnMapping {
  uuid: string | null;
  nicked: boolean;
  expiresAt: number;
}

interface MemorySample {
  usedBytes: number;
  maxBytes: number;
  evictedKeys: number;
  sampledAt: number;
}

export interface IgnMappingEntry {
  uuid: string | null;
  nicked: boolean;
  expiresAt: number;
}

interface CacheEntryWithCachedAt<T> extends CacheEntry<T> {
  cachedAt: number | null;
}

// Stale-While-Revalidate (SWR) cache result with staleness information
export interface SWRCacheEntry<T> extends CacheEntry<T> {
  isStale: boolean;
  staleAgeMs: number;
}

let lastMemorySample: MemorySample | null = null;
let cachedAdaptiveTtlMs = PLAYER_L1_TTL_FALLBACK_MS;

export function buildPlayerCacheKey(uuid: string): string {
  return `${PLAYER_KEY_PREFIX}${uuid}`;
}

export function buildIgnMappingKey(ign: string): string {
  return `${IGN_MAPPING_PREFIX}${ign}`;
}

function parseRedisMemoryInfo(info: string, sampledAt: number): MemorySample | null {
  const usedMatch = info.match(/used_memory:(\d+)/);
  if (!usedMatch) {
    return null;
  }

  const maxMatch = info.match(/maxmemory:(\d+)/);
  const evictedMatch = info.match(/evicted_keys:(\d+)/);

  const usedBytes = Number.parseInt(usedMatch[1], 10);
  const rawMaxBytes = maxMatch ? Number.parseInt(maxMatch[1], 10) : 0;
  const maxBytes = rawMaxBytes > 0 ? rawMaxBytes : REDIS_CACHE_MAX_BYTES;
  const evictedKeys = evictedMatch ? Number.parseInt(evictedMatch[1], 10) : 0;

  if (!Number.isFinite(usedBytes)) {
    return null;
  }

  return {
    usedBytes,
    maxBytes,
    evictedKeys,
    sampledAt,
  };
}

function clampTtl(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return PLAYER_L1_TTL_FALLBACK_MS;
  }
  const floored = Math.floor(value);
  return Math.min(Math.max(floored, PLAYER_L1_TTL_MIN_MS), PLAYER_L1_TTL_MAX_MS);
}

function getAdaptiveL1TtlMs(): number {
  return cachedAdaptiveTtlMs;
}

async function refreshAdaptiveTtl(): Promise<void> {
  const now = Date.now();

  const client = getRedisClient();
  if (!client || client.status !== 'ready') {
    cachedAdaptiveTtlMs = PLAYER_L1_TTL_FALLBACK_MS;
    return;
  }

  let info: string;
  try {
    info = await client.info('memory');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn('[statsCache] redis memory info failed', message);
    cachedAdaptiveTtlMs = PLAYER_L1_TTL_FALLBACK_MS;
    return;
  }

  const sample = parseRedisMemoryInfo(info, now);
  if (!sample) {
    cachedAdaptiveTtlMs = PLAYER_L1_TTL_FALLBACK_MS;
    return;
  }

  let ttlMs = PLAYER_L1_TTL_FALLBACK_MS;
  if (sample.maxBytes > 0) {
    const targetBytes = sample.maxBytes * PLAYER_L1_TARGET_UTILIZATION;
    const headroom = targetBytes - sample.usedBytes;
    if (headroom <= 0) {
      ttlMs = PLAYER_L1_TTL_MIN_MS;
    } else if (lastMemorySample) {
      const elapsedSeconds = (now - lastMemorySample.sampledAt) / 1000;
      const deltaBytes = sample.usedBytes - lastMemorySample.usedBytes;
      if (elapsedSeconds > 0 && deltaBytes > 0) {
        const growthPerSecond = deltaBytes / elapsedSeconds;
        const timeToTargetMs = (headroom / growthPerSecond) * 1000;
        ttlMs = timeToTargetMs * PLAYER_L1_SAFETY_FACTOR;
      }
    }
  }

  ttlMs = clampTtl(ttlMs);
  if (lastMemorySample && sample.evictedKeys > lastMemorySample.evictedKeys) {
    ttlMs = Math.max(PLAYER_L1_TTL_MIN_MS, Math.floor(ttlMs * 0.5));
  }

  lastMemorySample = sample;
  cachedAdaptiveTtlMs = ttlMs;
}

let adaptiveTtlInterval: ReturnType<typeof setInterval> | null = null;

export function startAdaptiveTtlRefresh(): void {
  if (adaptiveTtlInterval) {
    return;
  }
  void refreshAdaptiveTtl().catch((e) =>
    console.warn('[statsCache] initial adaptive TTL refresh failed', e),
  );
  adaptiveTtlInterval = setInterval(() => {
    void refreshAdaptiveTtl().catch((e) =>
      console.warn('[statsCache] adaptive TTL refresh failed', e),
    );
  }, PLAYER_L1_INFO_REFRESH_MS);
}

export function stopAdaptiveTtlRefresh(): void {
  if (adaptiveTtlInterval) {
    clearInterval(adaptiveTtlInterval);
    adaptiveTtlInterval = null;
  }
}

function mapRow<T>(row: CacheRow): CacheEntryWithCachedAt<T> | null {
  const expiresAtRaw = row.expires_at;
  const expiresAt = typeof expiresAtRaw === 'string' ? Number.parseInt(expiresAtRaw, 10) : Number(expiresAtRaw);
  const lastModifiedRaw = row.last_modified;
  const lastModified =
    lastModifiedRaw === null
      ? null
      : typeof lastModifiedRaw === 'string'
      ? Number.parseInt(lastModifiedRaw, 10)
      : Number(lastModifiedRaw);
  const cachedAtRaw = row.cached_at;
  const cachedAtParsed =
    cachedAtRaw === null || cachedAtRaw === undefined
      ? NaN
      : typeof cachedAtRaw === 'string'
        ? Number.parseInt(cachedAtRaw, 10)
        : Number(cachedAtRaw);
  const cachedAt = Number.isFinite(cachedAtParsed) ? cachedAtParsed : null;

  let parsedPayload: unknown = row.payload;
  if (typeof row.payload === 'string') {
    try {
      parsedPayload = JSON.parse(row.payload);
    } catch {
      return null;
    }
  }

  const source = row.source as CacheSource | null;
  const validSource =
    source === 'hypixel' || source === 'community_verified' || source === 'community_unverified' ? source : null;

  return {
    value: parsedPayload as T,
    expiresAt,
    cachedAt,
    etag: row.etag,
    lastModified,
    source: validSource,
  };
}

async function getManyPlayerStatsFromDb(
  keys: string[],
  includeExpired: boolean,
): Promise<Map<string, CacheEntryWithCachedAt<MinimalPlayerStats>>> {
  await ensureInitialized();

  const result = new Map<string, CacheEntryWithCachedAt<MinimalPlayerStats>>();
  if (keys.length === 0) {
    return result;
  }

  try {
    let queryResult;
    if (pool.type === DatabaseType.POSTGRESQL) {
      queryResult = await pool.query<CacheRow & { cache_key: string }>(
        'SELECT payload, expires_at, cached_at, etag, last_modified, source, cache_key FROM player_stats_cache WHERE cache_key = ANY($1)',
        [keys],
      );
    } else {
      const placeholders = keys.map((_, i) => `@p${i + 1}`).join(',');
      queryResult = await pool.query<CacheRow & { cache_key: string }>(
        `SELECT payload, expires_at, cached_at, etag, last_modified, source, cache_key FROM player_stats_cache WHERE cache_key IN (${placeholders})`,
        keys,
      );
    }
    markDbAccess();

    for (const row of queryResult.rows) {
      const cacheKey = row.cache_key;
      const entry = mapRow<MinimalPlayerStats>(row);

      if (!entry) {
        if (!includeExpired) {
          void pool.query('DELETE FROM player_stats_cache WHERE cache_key = $1', [cacheKey])
            .catch((e) => console.warn('[statsCache] failed to delete invalid L2 entry', e));
        }
        continue;
      }

      const now = Date.now();
      if (Number.isNaN(entry.expiresAt) || entry.expiresAt <= now) {
        if (!includeExpired) {
          void pool.query('DELETE FROM player_stats_cache WHERE cache_key = $1', [cacheKey])
            .catch((e) => console.warn('[statsCache] failed to delete expired L2 entry', e));
        }
        if (includeExpired) {
          result.set(cacheKey, entry);
        }
        continue;
      }

      result.set(cacheKey, entry);
    }
  } catch (error) {
    console.error('[statsCache] failed to batch read L2 cache', error);
  }

  return result;
}

async function getPlayerStatsFromDb(
  key: string,
  includeExpired: boolean,
): Promise<CacheEntryWithCachedAt<MinimalPlayerStats> | null> {
  await ensureInitialized();

  try {
    const result = await pool.query<CacheRow>(
      'SELECT payload, expires_at, cached_at, etag, last_modified, source FROM player_stats_cache WHERE cache_key = $1',
      [key],
    );
    markDbAccess();
    const row = result.rows[0];
    if (!row) {
      return null;
    }

    const entry = mapRow<MinimalPlayerStats>(row);
    if (!entry) {
      if (!includeExpired) {
        await pool.query('DELETE FROM player_stats_cache WHERE cache_key = $1', [key]);
      }
      return null;
    }

    const now = Date.now();
    if (Number.isNaN(entry.expiresAt) || entry.expiresAt <= now) {
      if (!includeExpired) {
        await pool.query('DELETE FROM player_stats_cache WHERE cache_key = $1', [key]);
      }
    return includeExpired ? entry : null;
    }

    return entry;
  } catch (error) {
    console.error('[statsCache] failed to read L2 cache', error);
    return null;
  }
}

async function setPlayerStatsInDb(
  key: string,
  stats: MinimalPlayerStats,
  ttlMs: number,
  metadata: CacheMetadata,
): Promise<void> {
  await ensureInitialized();

  const cachedAt = Date.now();
  const expiresAt = cachedAt + ttlMs;
  const payload = JSON.stringify(stats);

  try {
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
  } catch (error) {
    console.error('[statsCache] failed to write L2 cache', error);
  }
}

async function getIgnMappingFromDb(ign: string, includeExpired: boolean): Promise<IgnMappingEntry | null> {
  await ensureInitialized();

  try {
    const result = await pool.query<IgnCacheRow>(
      'SELECT uuid, nicked, expires_at FROM ign_uuid_cache WHERE ign = $1',
      [ign],
    );
    markDbAccess();
    const row = result.rows[0];
    if (!row) {
      return null;
    }

    const expiresAtRaw = row.expires_at;
    const parsedExpiresAt = typeof expiresAtRaw === 'string' ? Number.parseInt(expiresAtRaw, 10) : Number(expiresAtRaw);
    const expiresAt = Number.isFinite(parsedExpiresAt) ? parsedExpiresAt : 0;
    const now = Date.now();
    if (expiresAt <= now) {
      if (!includeExpired) {
        await pool.query('DELETE FROM ign_uuid_cache WHERE ign = $1', [ign]);
      }
      return includeExpired
        ? { uuid: row.uuid, nicked: Boolean(row.nicked), expiresAt }
        : null;
    }

    return { uuid: row.uuid, nicked: Boolean(row.nicked), expiresAt };
  } catch (error) {
    console.error('[statsCache] failed to read ign mapping', error);
    return null;
  }
}

async function setIgnMappingInDb(ign: string, uuid: string | null, nicked: boolean, ttlMs: number): Promise<void> {
  await ensureInitialized();

  const expiresAt = Date.now() + ttlMs;
  try {
    if (pool.type === DatabaseType.POSTGRESQL) {
      await pool.query(
        `INSERT INTO ign_uuid_cache (ign, uuid, nicked, expires_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (ign) DO UPDATE
         SET uuid = EXCLUDED.uuid,
             nicked = EXCLUDED.nicked,
             expires_at = EXCLUDED.expires_at,
             updated_at = NOW()`,
        [ign, uuid, nicked, expiresAt],
      );
    } else {
      await pool.query(
        `MERGE ign_uuid_cache AS target
         USING (SELECT $1 AS ign, $2 AS uuid, $3 AS nicked, $4 AS expires_at) AS source
         ON (target.ign = source.ign)
         WHEN MATCHED THEN
           UPDATE SET uuid = source.uuid,
                      nicked = source.nicked,
                      expires_at = source.expires_at,
                      updated_at = SYSUTCDATETIME()
         WHEN NOT MATCHED THEN
           INSERT (ign, uuid, nicked, expires_at)
           VALUES (source.ign, source.uuid, source.nicked, source.expires_at);`,
        [ign, uuid, nicked, expiresAt],
      );
    }
    markDbAccess();
  } catch (error) {
    console.error('[statsCache] failed to write ign mapping', error);
  }
}

async function getIgnMappingFromRedis(ign: string, includeExpired: boolean): Promise<IgnMappingEntry | null> {
  const client = getRedisClient();
  if (!client || client.status !== 'ready') {
    return null;
  }

  try {
    const redisKey = `cache:${buildIgnMappingKey(ign)}`;
    const data = await client.get(redisKey);
    if (!data) {
      return null;
    }

    let parsed: RedisIgnMapping;
    try {
      parsed = JSON.parse(data) as RedisIgnMapping;
    } catch {
      await client.del(redisKey);
      return null;
    }

    const now = Date.now();
    const expiresAt = Number.isFinite(parsed.expiresAt) ? parsed.expiresAt : 0;
    if (expiresAt <= now) {
      await client.del(redisKey);
      return includeExpired ? { uuid: parsed.uuid, nicked: parsed.nicked, expiresAt } : null;
    }

    return { uuid: parsed.uuid, nicked: parsed.nicked, expiresAt };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[statsCache] getIgnMapping failed', message);
    return null;
  }
}

async function setIgnMappingInRedis(ign: string, mapping: IgnMappingEntry, ttlMs: number): Promise<void> {
  const client = getRedisClient();
  if (!client || client.status !== 'ready') {
    return;
  }

  try {
    const expiresAt = Date.now() + ttlMs;
    const redisKey = `cache:${buildIgnMappingKey(ign)}`;
    const data = JSON.stringify({
      uuid: mapping.uuid,
      nicked: mapping.nicked,
      expiresAt,
    });
    await client.setex(redisKey, Math.ceil(ttlMs / 1000), data);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[statsCache] setIgnMapping failed', message);
  }
}

export async function getPlayerStatsFromCache(
  key: string,
  includeExpired: boolean = false,
): Promise<CacheEntry<MinimalPlayerStats> | null> {
  let l1Attempted = false;
  let l1Hit = false;
  if (isRedisAvailable()) {
    l1Attempted = true;
    try {
      const client = getRedisClient();
      if (client && client.status === 'ready') {
        const redisKey = `cache:${key}`;
        const data = await client.get(redisKey);
        if (data) {
          let row: CacheRow | undefined;
          try {
            row = JSON.parse(data) as CacheRow;
          } catch {
            await client.del(redisKey);
            // Skip processing this cache entry
          }
          if (row) {
            const entry = mapRow<MinimalPlayerStats>(row);
            if (entry) {
              const now = Date.now();
              if (entry.expiresAt > now) {
                recordCacheHit();
                recordCacheTierHit('l1');
                recordCacheSourceHit('redis');
                l1Hit = true;
                return entry;
              }
              await client.del(redisKey);
            }
          }
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[statsCache] L1 read failed', message);
    }
  }

  if (l1Attempted && !l1Hit) {
    recordCacheTierMiss('l1', 'absent');
    recordCacheMiss('absent');
  }

  if (!shouldReadFromDb()) {
    recordCacheTierMiss('l2', 'db_cold');
    recordCacheMiss('db_cold');
    return null;
  }

  const l2Entry = await getPlayerStatsFromDb(key, includeExpired);
  if (l2Entry) {
    recordCacheHit();
    recordCacheTierHit('l2');
    recordCacheSourceHit('sql');
    const now = Date.now();
    if (l2Entry.expiresAt > now) {
      void setPlayerStatsL1(key, l2Entry.value, {
        etag: l2Entry.etag ?? undefined,
        lastModified: l2Entry.lastModified ?? undefined,
        source: l2Entry.source ?? undefined,
      }).catch((e) => console.warn('[statsCache] L1 backfill failed', e));
    }
    return l2Entry;
  }

  recordCacheTierMiss('l2', 'absent');
  recordCacheMiss('absent');
  return null;
}

/**
 * Get player stats from cache with Stale-While-Revalidate (SWR) support.
 * 
 * Returns stale data immediately if it's within the SWR window, while triggering
 * a background refresh. This improves response times for cache misses by serving
 * slightly outdated data rather than waiting for a fresh fetch.
 * 
 * @param key - The cache key
 * @param uuid - The player UUID (for background refresh)
 * @returns SWRCacheEntry with staleness information, or null if no usable data
 */
export async function getPlayerStatsFromCacheWithSWR(
  key: string,
  uuid: string,
): Promise<SWRCacheEntry<MinimalPlayerStats> | null> {
  if (!SWR_ENABLED) {
    const entry = await getPlayerStatsFromCache(key, false);
    if (!entry) return null;
    return {
      ...entry,
      isStale: false,
      staleAgeMs: 0,
    };
  }

  // Try L1 (Redis) first
  let l1MissReason = 'absent';
  if (isRedisAvailable()) {
    try {
      const client = getRedisClient();
      if (client && client.status === 'ready') {
        const redisKey = `cache:${key}`;
        const data = await client.get(redisKey);
        if (data) {
          let row: CacheRow | undefined;
          try {
            row = JSON.parse(data) as CacheRow;
          } catch {
            await client.del(redisKey);
          }
          if (row) {
            const entry = mapRow<MinimalPlayerStats>(row);
            if (entry) {
              const now = Date.now();
              const isFresh = entry.expiresAt > now;
              const cachedAt = entry.cachedAt ?? (entry.expiresAt - getAdaptiveL1TtlMs());
              const ageMs = now - cachedAt;

              if (isFresh) {
                recordCacheHit();
                recordCacheTierHit('l1');
                recordCacheSourceHit('redis');
                return {
                  ...entry,
                  isStale: false,
                  staleAgeMs: 0,
                };
              }

              // Check if within SWR window
              const isWithinSWRWindow = now <= entry.expiresAt + SWR_STALE_TTL_MS;
              if (isWithinSWRWindow) {
                recordCacheHit();
                recordCacheTierHit('l1');
                recordCacheSourceHit('redis');
                
                // Trigger background refresh
                triggerBackgroundRefresh(key, uuid, entry);
                
                return {
                  ...entry,
                  isStale: true,
                  staleAgeMs: ageMs,
                };
              }

              // Too old, delete from Redis
              await client.del(redisKey);
              l1MissReason = 'expired';
            }
          }
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[statsCache] L1 SWR read failed', message);
    }
  }

  recordCacheTierMiss('l1', l1MissReason);

  // Try L2 (Database) with SWR
  if (shouldReadFromDb()) {
    const l2Entry = await getPlayerStatsFromDb(key, true);
    if (l2Entry) {
      const now = Date.now();
      const normalTtl = PLAYER_L2_TTL_MS;
      const cachedAt = l2Entry.cachedAt ?? l2Entry.expiresAt - normalTtl;
      const ageMs = now - cachedAt;
      const isFresh = l2Entry.expiresAt > now;
      const isWithinSWRWindow = now <= l2Entry.expiresAt + SWR_STALE_TTL_MS;

      if (isFresh) {
        recordCacheHit();
        recordCacheTierHit('l2');
        recordCacheSourceHit('sql');
        
        // Backfill L1 cache
        void setPlayerStatsL1(key, l2Entry.value, {
          etag: l2Entry.etag ?? undefined,
          lastModified: l2Entry.lastModified ?? undefined,
          source: l2Entry.source ?? undefined,
        }).catch((e) => console.warn('[statsCache] L1 backfill failed', e));
        
        return {
          ...l2Entry,
          isStale: false,
          staleAgeMs: 0,
        };
      }

      if (isWithinSWRWindow) {
        recordCacheHit();
        recordCacheTierHit('l2');
        recordCacheSourceHit('sql');
        
        // Trigger background refresh
        triggerBackgroundRefresh(key, uuid, l2Entry);
        
        return {
          ...l2Entry,
          isStale: true,
          staleAgeMs: ageMs,
        };
      }

      // Data is too old, delete it
      await pool.query('DELETE FROM player_stats_cache WHERE cache_key = $1', [key]);
      markDbAccess();
      recordCacheMiss('expired');
      return null;
    }
  } else {
    recordCacheTierMiss('l2', 'db_cold');
  }

  recordCacheMiss('absent');
  return null;
}

/**
 * Trigger a background refresh of player stats from Hypixel.
 * This function doesn't wait for the refresh to complete.
 */
function triggerBackgroundRefresh(
  key: string,
  uuid: string,
  entry: CacheEntry<MinimalPlayerStats>,
): void {
  // Use single-flight pattern to prevent duplicate fetches
  if (backgroundRefreshLocks.has(key)) {
    return;
  }

  const fetchPromise = (async () => {
    try {
      const options: HypixelFetchOptions = {
        etag: entry.etag ?? undefined,
        lastModified: entry.lastModified ?? undefined,
      };

      const result = await fetchHypixelPlayer(uuid, options);

      if (result.notModified) {
        // Data hasn't changed, update L1 cache TTL
        await setPlayerStatsL1(key, entry.value, {
          etag: entry.etag ?? undefined,
          lastModified: entry.lastModified ?? undefined,
          source: entry.source ?? undefined,
        });
        recordCacheRefresh('success');
        return;
      }

      if (result.payload) {
        const stats = extractMinimalStats(result.payload);
        await setPlayerStatsBoth(key, stats, {
          etag: result.etag ?? undefined,
          lastModified: result.lastModified ?? undefined,
          source: 'hypixel',
        });
        recordCacheRefresh('success');
      }
    } catch (error) {
      console.warn('[statsCache] background refresh failed for %s', uuid, error);
      recordCacheRefresh('fail');
    } finally {
      backgroundRefreshLocks.delete(key);
    }
  })();

  backgroundRefreshLocks.set(key, fetchPromise);
  
  // Don't await - let it run in background
  void fetchPromise.catch(() => {
    // Error already logged in the try/catch above
  });
}

/**
 * Fetch multiple player stats from L1 cache (Redis) with SWR support.
 * Optimized using MGET to reduce network round-trips.
 */
export async function getManyPlayerStatsFromCacheWithSWR(
  identifiers: { key: string; uuid: string }[]
): Promise<Map<string, SWRCacheEntry<MinimalPlayerStats>>> {
  const result = new Map<string, SWRCacheEntry<MinimalPlayerStats>>();

  if (identifiers.length === 0) {
    return result;
  }

  if (!isRedisAvailable()) {
    return result;
  }

  const client = getRedisClient();
  if (!client || client.status !== 'ready') {
    return result;
  }

  const redisKeys = identifiers.map((i) => `cache:${i.key}`);

  try {
    const values = await client.mget(...redisKeys);

    for (let i = 0; i < values.length; i++) {
      const val = values[i];
      if (!val) continue;

      const identifier = identifiers[i];
      let row: CacheRow | undefined;
      try {
        row = JSON.parse(val) as CacheRow;
      } catch {
        continue;
      }

      if (!row) continue;

      const entry = mapRow<MinimalPlayerStats>(row);
      if (!entry) continue;

      const now = Date.now();
      const isFresh = entry.expiresAt > now;
      const cachedAt = entry.cachedAt ?? (entry.expiresAt - getAdaptiveL1TtlMs());
      const ageMs = now - cachedAt;

      if (isFresh) {
        recordCacheHit();
        recordCacheTierHit('l1');
        recordCacheSourceHit('redis');
        result.set(identifier.key, {
          ...entry,
          isStale: false,
          staleAgeMs: 0,
        });
        continue;
      }

      if (SWR_ENABLED) {
        const isWithinSWRWindow = now <= entry.expiresAt + SWR_STALE_TTL_MS;
        if (isWithinSWRWindow) {
          recordCacheHit();
          recordCacheTierHit('l1');
          recordCacheSourceHit('redis');

          triggerBackgroundRefresh(identifier.key, identifier.uuid, entry);

          result.set(identifier.key, {
            ...entry,
            isStale: true,
            staleAgeMs: ageMs,
          });
          continue;
        }
      }

      // Expired and not SWR-eligible, ignore.
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[statsCache] L1 batch read failed', message);
  }

  const missing = identifiers.filter((i) => !result.has(i.key));
  if (missing.length > 0 && shouldReadFromDb()) {
    const missingKeys = missing.map((m) => m.key);
    const l2Results = await getManyPlayerStatsFromDb(missingKeys, true);
    const expiredKeys: string[] = [];

    for (const [key, entry] of l2Results) {
      const idObj = missing.find((m) => m.key === key);
      if (!idObj) continue;

      const now = Date.now();
      const normalTtl = PLAYER_L2_TTL_MS;
      const cachedAt = entry.cachedAt ?? entry.expiresAt - normalTtl;
      const ageMs = now - cachedAt;
      const isFresh = entry.expiresAt > now;
      const isWithinSWRWindow = now <= entry.expiresAt + SWR_STALE_TTL_MS;

      if (isFresh) {
        recordCacheHit();
        recordCacheTierHit('l2');
        recordCacheSourceHit('sql');

        void setPlayerStatsL1(key, entry.value, {
          etag: entry.etag ?? undefined,
          lastModified: entry.lastModified ?? undefined,
          source: entry.source ?? undefined,
        }).catch((e) => console.warn('[statsCache] L1 backfill failed', e));

        result.set(key, {
          ...entry,
          isStale: false,
          staleAgeMs: 0,
        });
        continue;
      }

      if (SWR_ENABLED && isWithinSWRWindow) {
        recordCacheHit();
        recordCacheTierHit('l2');
        recordCacheSourceHit('sql');

        triggerBackgroundRefresh(key, idObj.uuid, entry);

        result.set(key, {
          ...entry,
          isStale: true,
          staleAgeMs: ageMs,
        });
        continue;
      }

      expiredKeys.push(key);
      recordCacheMiss('expired');
    }

    if (expiredKeys.length > 0) {
      const doBatchDelete = async () => {
        try {
          if (pool.type === DatabaseType.POSTGRESQL) {
            await pool.query('DELETE FROM player_stats_cache WHERE cache_key = ANY($1)', [expiredKeys]);
          } else {
            const placeholders = expiredKeys.map((_, i) => `@p${i + 1}`).join(',');
            await pool.query(`DELETE FROM player_stats_cache WHERE cache_key IN (${placeholders})`, expiredKeys);
          }
        } catch (e) {
          console.warn('[statsCache] failed to batch delete expired L2 entries', e);
        }
      };
      void doBatchDelete();
    }

    const stillMissing = missing.filter((m) => !result.has(m.key));
    for (const _ of stillMissing) {
      recordCacheTierMiss('l2', 'absent');
      recordCacheMiss('absent');
    }
  } else if (missing.length > 0) {
    for (const _ of missing) {
      recordCacheTierMiss('l2', 'db_cold');
      recordCacheMiss('db_cold');
    }
  }

  return result;
}

export async function setPlayerStatsL1(
  key: string,
  stats: MinimalPlayerStats,
  metadata: CacheMetadata = {},
): Promise<void> {
  const client = getRedisClient();
  if (!client || client.status !== 'ready') {
    return;
  }

  try {
    const ttlMs = getAdaptiveL1TtlMs();
    const cachedAt = Date.now();
    const expiresAt = cachedAt + ttlMs;
    // Bolt: Optimized to avoid double serialization. 'stats' is embedded as an object.
    const data = JSON.stringify({
      payload: stats,
      expires_at: expiresAt,
      cached_at: cachedAt,
      etag: metadata.etag ?? null,
      last_modified: metadata.lastModified ?? null,
      source: metadata.source ?? null,
    });

    const redisKey = `cache:${key}`;
    await client.setex(redisKey, Math.ceil(ttlMs / 1000), data);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[statsCache] setPlayerStatsL1 failed', message);
  }
}

export async function setPlayerStatsBoth(
  key: string,
  stats: MinimalPlayerStats,
  metadata: CacheMetadata = {},
): Promise<void> {
  await Promise.all([
    setPlayerStatsInDb(key, stats, PLAYER_L2_TTL_MS, metadata),
    setPlayerStatsL1(key, stats, metadata),
  ]);
}

export async function getIgnMapping(
  ign: string,
  includeExpired: boolean = false,
): Promise<IgnMappingEntry | null> {
  const l1Entry = await getIgnMappingFromRedis(ign, includeExpired);
  if (l1Entry) {
    recordCacheHit();
    return l1Entry;
  }

  if (!shouldReadFromDb()) {
    recordCacheMiss('db_cold');
    return null;
  }

  const l2Entry = await getIgnMappingFromDb(ign, includeExpired);
  if (l2Entry) {
    recordCacheHit();
    const now = Date.now();
    if (l2Entry.expiresAt > now) {
      const ttlMs = getAdaptiveL1TtlMs();
      void setIgnMappingInRedis(ign, l2Entry, ttlMs).catch((e) =>
        console.warn('[statsCache] IGN L1 backfill failed', e),
      );
    }
    return l2Entry;
  }

  recordCacheMiss('absent');
  return null;
}

export async function setIgnMapping(ign: string, uuid: string | null, nicked: boolean): Promise<void> {
  const ttlMs = getAdaptiveL1TtlMs();
  await Promise.all([
    setIgnMappingInRedis(ign, { uuid, nicked, expiresAt: Date.now() + ttlMs }, ttlMs),
    setIgnMappingInDb(ign, uuid, nicked, IGN_L2_TTL_MS),
  ]);
}

export async function deletePlayerStatsEntries(keys: string[]): Promise<number> {
  if (keys.length === 0) {
    return 0;
  }

  if (isRedisAvailable()) {
    const client = getRedisClient();
    if (client && client.status === 'ready') {
      try {
        const redisKeys = keys.map((key) => `cache:${key}`);
        await client.del(...redisKeys);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error('[statsCache] delete L1 stats failed', message);
      }
    }
  }

  await ensureInitialized();

  try {
    if (pool.type === DatabaseType.POSTGRESQL) {
      const result = await pool.query('DELETE FROM player_stats_cache WHERE cache_key = ANY($1)', [keys]);
      markDbAccess();
      return result.rowCount;
    }

    const placeholders = keys.map((_, i) => `@p${i + 1}`).join(',');
    const result = await pool.query(`DELETE FROM player_stats_cache WHERE cache_key IN (${placeholders})`, keys);
    markDbAccess();
    return result.rowCount;
  } catch (error) {
    console.error('[statsCache] delete L2 stats failed', error);
    return 0;
  }
}

export async function deleteIgnMappings(igns: string[]): Promise<number> {
  if (igns.length === 0) {
    return 0;
  }

  if (isRedisAvailable()) {
    const client = getRedisClient();
    if (client && client.status === 'ready') {
      try {
        const redisKeys = igns.map((ign) => `cache:${buildIgnMappingKey(ign)}`);
        await client.del(...redisKeys);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error('[statsCache] delete L1 ign mappings failed', message);
      }
    }
  }

  await ensureInitialized();

  try {
    if (pool.type === DatabaseType.POSTGRESQL) {
      const result = await pool.query('DELETE FROM ign_uuid_cache WHERE ign = ANY($1)', [igns]);
      markDbAccess();
      return result.rowCount;
    }

    const placeholders = igns.map((_, i) => `@p${i + 1}`).join(',');
    const result = await pool.query(`DELETE FROM ign_uuid_cache WHERE ign IN (${placeholders})`, igns);
    markDbAccess();
    return result.rowCount;
  } catch (error) {
    console.error('[statsCache] delete L2 ign mappings failed', error);
    return 0;
  }
}

export async function clearAllPlayerStatsCaches(): Promise<number> {
  let deleted = 0;

  if (isRedisAvailable()) {
    const client = getRedisClient();
    if (client && client.status === 'ready') {
      try {
        let cursor = '0';
        // Optimized: Increased COUNT to 1000 to reduce network round-trips.
        do {
          const [newCursor, keys] = await client.scan(cursor, 'MATCH', 'cache:*', 'COUNT', 1000);
          cursor = newCursor;
          if (keys.length > 0) {
            await client.del(...keys);
            deleted += keys.length;
          }
        } while (cursor !== '0');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error('[statsCache] clear L1 caches failed', message);
      }
    }
  }

  await ensureInitialized();

  try {
    const statsResult = await pool.query('DELETE FROM player_stats_cache');
    const ignResult = await pool.query('DELETE FROM ign_uuid_cache');
    markDbAccess();
    return deleted + statsResult.rowCount + ignResult.rowCount;
  } catch (error) {
    console.error('[statsCache] clear L2 caches failed', error);
    return deleted;
  }
}
