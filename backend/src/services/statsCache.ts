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
} from '../config';
import { CacheEntry, CacheMetadata, CacheSource, ensureInitialized, markDbAccess, pool, shouldReadFromDb } from './cache';
import { DatabaseType } from './database/adapter';
import { recordCacheHit, recordCacheMiss, recordCacheTierHit, recordCacheTierMiss } from './metrics';
import { MinimalPlayerStats } from './hypixel';
import { getRedisClient, isRedisAvailable } from './redis';

const PLAYER_KEY_PREFIX = 'player:';
const IGN_MAPPING_PREFIX = 'ignmap:';

interface CacheRow {
  payload: unknown;
  expires_at: number | string;
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

let lastMemorySample: MemorySample | null = null;
let lastTtlRefreshAt = 0;
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

async function getAdaptiveL1TtlMs(): Promise<number> {
  const now = Date.now();
  if (now - lastTtlRefreshAt < PLAYER_L1_INFO_REFRESH_MS) {
    return cachedAdaptiveTtlMs;
  }

  const client = getRedisClient();
  if (!client || client.status !== 'ready') {
    cachedAdaptiveTtlMs = PLAYER_L1_TTL_FALLBACK_MS;
    return cachedAdaptiveTtlMs;
  }

  let info: string;
  try {
    info = await client.info('memory');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn('[statsCache] redis memory info failed', message);
    cachedAdaptiveTtlMs = PLAYER_L1_TTL_FALLBACK_MS;
    return cachedAdaptiveTtlMs;
  }

  const sample = parseRedisMemoryInfo(info, now);
  if (!sample) {
    cachedAdaptiveTtlMs = PLAYER_L1_TTL_FALLBACK_MS;
    return cachedAdaptiveTtlMs;
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
  lastTtlRefreshAt = now;
  cachedAdaptiveTtlMs = ttlMs;
  return cachedAdaptiveTtlMs;
}

function mapRow<T>(row: CacheRow): CacheEntry<T> | null {
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
    etag: row.etag,
    lastModified,
    source: validSource,
  };
}

async function getPlayerStatsFromDb(
  key: string,
  includeExpired: boolean,
): Promise<CacheEntry<MinimalPlayerStats> | null> {
  await ensureInitialized();

  try {
    const result = await pool.query<CacheRow>(
      'SELECT payload, expires_at, etag, last_modified, source FROM player_stats_cache WHERE cache_key = $1',
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

  const expiresAt = Date.now() + ttlMs;
  const payload = JSON.stringify(stats);

  try {
    if (pool.type === DatabaseType.POSTGRESQL) {
      await pool.query(
        `INSERT INTO player_stats_cache (cache_key, payload, expires_at, etag, last_modified, source)
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
        `MERGE player_stats_cache AS target
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
    const now = Date.now();
    if (l2Entry.expiresAt > now) {
      await setPlayerStatsL1(key, l2Entry.value, {
        etag: l2Entry.etag ?? undefined,
        lastModified: l2Entry.lastModified ?? undefined,
        source: l2Entry.source ?? undefined,
      });
    }
    return l2Entry;
  }

  recordCacheTierMiss('l2', 'absent');
  recordCacheMiss('absent');
  return null;
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
    const ttlMs = await getAdaptiveL1TtlMs();
    const expiresAt = Date.now() + ttlMs;
    // Bolt: Optimized to avoid double serialization. 'stats' is embedded as an object.
    const data = JSON.stringify({
      payload: stats,
      expires_at: expiresAt,
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
      const ttlMs = await getAdaptiveL1TtlMs();
      await setIgnMappingInRedis(ign, l2Entry, ttlMs);
    }
    return l2Entry;
  }

  recordCacheMiss('absent');
  return null;
}

export async function setIgnMapping(ign: string, uuid: string | null, nicked: boolean): Promise<void> {
  const ttlMs = await getAdaptiveL1TtlMs();
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
        do {
          const [newCursor, keys] = await client.scan(cursor, 'MATCH', 'cache:*', 'COUNT', 100);
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
