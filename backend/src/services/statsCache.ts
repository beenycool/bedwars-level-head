import {
  IGN_L2_TTL_MS, PLAYER_L1_INFO_REFRESH_MS, PLAYER_L1_SAFETY_FACTOR, PLAYER_L1_TARGET_UTILIZATION, PLAYER_L1_TTL_FALLBACK_MS,
  PLAYER_L1_TTL_MAX_MS, PLAYER_L1_TTL_MIN_MS, PLAYER_L2_TTL_MS, REDIS_CACHE_MAX_BYTES, SWR_ENABLED, SWR_STALE_TTL_MS,
} from '../config';
import { CacheEntry, CacheMetadata, CacheSource, ensureInitialized, markDbAccess, pool, shouldReadFromDb } from './cache';
import { recordCacheHit, recordCacheMiss, recordCacheTierHit, recordCacheTierMiss, recordCacheSourceHit, recordCacheRefresh } from './metrics';
import { fetchHypixelPlayer, HypixelFetchOptions, MinimalPlayerStats, extractMinimalStats } from './hypixel';
import { getRedisClient, isRedisAvailable } from './redis';
import { logger } from '../util/logger';

const fLocks: Map<string, Promise<any>> = new Map(); const bgLocks: Map<string, Promise<void>> = new Map();
const P_KEY = 'player:'; const IGN_KEY = 'ignmap:';

export async function fetchWithDedupe(uuid: string, options?: HypixelFetchOptions): Promise<any> {
  const norm = uuid.toLowerCase(); const ex = fLocks.get(norm); if (ex) return await ex;
  const prom: Promise<any> = (async (): Promise<any> => {
    const res = await fetchHypixelPlayer(norm, options);
    if (res.notModified) throw new Error('Unexpected 304'); if (!res.payload) throw new Error('Empty payload');
    return { stats: extractMinimalStats(res.payload), etag: res.etag, lastModified: res.lastModified };
  })();
  fLocks.set(norm, prom); try { return await prom; } finally { fLocks.delete(norm); }
}

interface CacheRow { payload: unknown; expires_at: number | string; cached_at?: number | string | null; etag: string | null; last_modified: number | string | null; source: string | null; }
interface IgnRow { uuid: string | null; nicked: boolean | number; expires_at: number | string; }

let lMem: any = null; let cAdpTtl = PLAYER_L1_TTL_FALLBACK_MS;
export function buildPlayerCacheKey(uuid: string): string { return `${P_KEY}${uuid}`; }
export function buildIgnMappingKey(ign: string): string { return `${IGN_KEY}${ign}`; }

function parseRedisMem(info: string, ts: number): any {
  const uMatch = info.match(/used_memory:(\d+)/); if (!uMatch) return null;
  const mMatch = info.match(/maxmemory:(\d+)/); const eMatch = info.match(/evicted_keys:(\d+)/);
  const uB = Number.parseInt(uMatch[1], 10); const mB = mMatch ? Number.parseInt(mMatch[1], 10) : REDIS_CACHE_MAX_BYTES;
  const eK = eMatch ? Number.parseInt(eMatch[1], 10) : 0;
  return { usedBytes: uB, maxBytes: mB > 0 ? mB : REDIS_CACHE_MAX_BYTES, evictedKeys: eK, sampledAt: ts };
}

function getAdpTtl(): number { return cAdpTtl; }

async function refAdpTtl(): Promise<void> {
  const cli = getRedisClient(); if (!cli || cli.status !== 'ready') { cAdpTtl = PLAYER_L1_TTL_FALLBACK_MS; return; }
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
    logger.warn('[statsCache] redis memory info failed', message);
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
    ttl = Math.min(Math.max(Math.floor(ttl), PLAYER_L1_TTL_MIN_MS), PLAYER_L1_TTL_MAX_MS);
    if (lMem && sample.evictedKeys > lMem.evictedKeys) ttl = Math.max(PLAYER_L1_TTL_MIN_MS, Math.floor(ttl * 0.5));
    lMem = sample; cAdpTtl = ttl;
  } catch (e) { cAdpTtl = PLAYER_L1_TTL_FALLBACK_MS; }
}

let adpInt: any = null;
export function startAdaptiveTtlRefresh(): void { if (adpInt) return; void refAdpTtl(); adpInt = setInterval(refAdpTtl, PLAYER_L1_INFO_REFRESH_MS); }
export function stopAdaptiveTtlRefresh(): void { if (adpInt) { clearInterval(adpInt); adpInt = null; } }

export function startAdaptiveTtlRefresh(): void {
  if (adaptiveTtlInterval) {
    return;
  }
  void refreshAdaptiveTtl().catch((e) =>
    logger.warn('[statsCache] initial adaptive TTL refresh failed', e),
  );
  adaptiveTtlInterval = setInterval(() => {
    void refreshAdaptiveTtl().catch((e) =>
      logger.warn('[statsCache] adaptive TTL refresh failed', e),
    );
  }, PLAYER_L1_INFO_REFRESH_MS);
}

async function getManyPFromDb(keys: string[], incExp: boolean): Promise<Map<string, any>> {
  await ensureInitialized(); const res = new Map<string, any>(); if (keys.length === 0) return res;
  try {
    let queryResult;
    const { sql, params: inParams } = pool.formatInClause('cache_key', keys, 1);
    queryResult = await pool.query<CacheRow & { cache_key: string }>(
      `SELECT payload, expires_at, cached_at, etag, last_modified, source, cache_key FROM player_stats_cache WHERE ${sql}`,
      inParams,
    );
    markDbAccess();

    for (const row of queryResult.rows) {
      const cacheKey = row.cache_key;
      const entry = mapRow<MinimalPlayerStats>(row);

      if (!entry) {
        if (!includeExpired) {
          void pool.query('DELETE FROM player_stats_cache WHERE cache_key = $1', [cacheKey])
            .catch((e) => logger.warn('[statsCache] failed to delete invalid L2 entry', e));
        }
        continue;
      }

      const now = Date.now();
      if (Number.isNaN(entry.expiresAt) || entry.expiresAt <= now) {
        if (!includeExpired) {
          void pool.query('DELETE FROM player_stats_cache WHERE cache_key = $1', [cacheKey])
            .catch((e) => logger.warn('[statsCache] failed to delete expired L2 entry', e));
        }
        if (includeExpired) {
          result.set(cacheKey, entry);
        }
        continue;
      }

      result.set(cacheKey, entry);
    }
  } catch (error) {
    logger.error('[statsCache] failed to batch read L2 cache', error);
  }

  return result;
}

async function getPFromDb(key: string, incExp: boolean): Promise<any> {
  await ensureInitialized();
  try {
    const qRes = await pool.query<CacheRow>(`SELECT payload, expires_at, cached_at, etag, last_modified, source FROM player_stats_cache WHERE cache_key = ${pool.getPlaceholder(1)}`, [key]);
    markDbAccess(); const row = qRes.rows[0]; if (!row) return null;
    const entry = mapR<MinimalPlayerStats>(row); if (!entry) { if (!incExp) await pool.query(`DELETE FROM player_stats_cache WHERE cache_key = ${pool.getPlaceholder(1)}`, [key]); return null; }
    if (entry.expiresAt <= Date.now()) { if (!incExp) await pool.query(`DELETE FROM player_stats_cache WHERE cache_key = ${pool.getPlaceholder(1)}`, [key]); return incExp ? entry : null; }
    return entry;
  } catch (error) {
    logger.error('[statsCache] failed to read L2 cache', error);
    return null;
  }
}

async function setPInDb(key: string, stats: MinimalPlayerStats, ttl: number, meta: CacheMetadata): Promise<void> {
  await ensureInitialized(); const ca = Date.now(); const exp = ca + ttl; const p = JSON.stringify(stats);
  try {
    const columns = ['cache_key', 'payload', 'expires_at', 'cached_at', 'etag', 'last_modified', 'source'];
    const updateColumns = ['payload', 'expires_at', 'cached_at', 'etag', 'last_modified', 'source'];
    const sql = pool.getUpsertQuery('player_stats_cache', columns, 'cache_key', updateColumns);
    await pool.query(sql, [key, payload, expiresAt, cachedAt, metadata.etag ?? null, metadata.lastModified ?? null, metadata.source ?? null]);
    markDbAccess();
  } catch (error) {
    logger.error('[statsCache] failed to write L2 cache', error);
  }
}

async function getIMapFromDb(ign: string, incExp: boolean): Promise<any> {
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
    logger.error('[statsCache] failed to read ign mapping', error);
    return null;
  }
}

async function setIMapInDb(ign: string, uuid: string | null, nicked: boolean, ttl: number): Promise<void> {
  await ensureInitialized(); const exp = Date.now() + ttl;
  try {
    const columns = ['ign', 'uuid', 'nicked', 'expires_at'];
    const updateColumns = ['uuid', 'nicked', 'expires_at'];
    const sql = pool.getUpsertQuery('ign_uuid_cache', columns, 'ign', updateColumns);
    await pool.query(sql, [ign, uuid, nicked, expiresAt]);
    markDbAccess();
  } catch (error) {
    logger.error('[statsCache] failed to write ign mapping', error);
  }
}

async function getIMapFromRedis(ign: string, incExp: boolean): Promise<any> {
  const cli = getRedisClient(); if (!cli || cli.status !== 'ready') return null;
  try {
    const redisKey = getCacheKey(buildIgnMappingKey(ign));
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
    logger.error('[statsCache] getIgnMapping failed', message);
    return null;
  }
}

async function setIMapInRedis(ign: string, map: any, ttl: number): Promise<void> {
  const cli = getRedisClient(); if (!cli || cli.status !== 'ready') return;
  try {
    const expiresAt = Date.now() + ttlMs;
    const redisKey = getCacheKey(buildIgnMappingKey(ign));
    const data = JSON.stringify({
      uuid: mapping.uuid,
      nicked: mapping.nicked,
      expiresAt,
    });
    await client.setex(redisKey, Math.ceil(ttlMs / 1000), data);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('[statsCache] setIgnMapping failed', message);
  }
}

export async function getPlayerStatsFromCache(key: string, incExp = false): Promise<any> {
  if (isRedisAvailable()) {
    try {
      const client = getRedisClient();
      if (client && client.status === 'ready') {
        const redisKey = getCacheKey(key);
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
            const entry = mapR<MinimalPlayerStats>(row);
            if (entry && entry.expiresAt > Date.now()) { recordCacheHit(); recordCacheTierHit('l1'); recordCacheSourceHit('redis'); return entry; }
            await cli.del(k);
          }
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('[statsCache] L1 read failed', message);
    }
  }
  if (!shouldReadFromDb()) return null;
  const l2 = await getPFromDb(key, incExp);
  if (l2) {
    recordCacheHit(); recordCacheTierHit('l2'); recordCacheSourceHit('sql');
    if (l2.expiresAt > Date.now()) void setPlayerStatsL1(key, l2.value, l2).catch(() => {});
    return l2;
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
      }).catch((e) => logger.warn('[statsCache] L1 backfill failed', e));
    }
    return l2Entry;
  }

  recordCacheTierMiss('l2', 'absent');
  recordCacheMiss('absent');
  return null;
}

export async function getPlayerStatsFromCacheWithSWR(key: string, uuid: string): Promise<any> {
  if (!SWR_ENABLED) return await getPlayerStatsFromCache(key, false);
  if (isRedisAvailable()) {
    try {
      const client = getRedisClient();
      if (client && client.status === 'ready') {
        const redisKey = getCacheKey(key);
        const data = await client.get(redisKey);
        if (data) {
          let row: CacheRow | undefined;
          try {
            row = JSON.parse(data) as CacheRow;
          } catch {
            await client.del(redisKey);
          }
          if (row) {
            const entry = mapR<MinimalPlayerStats>(row);
            if (entry) {
              const now = Date.now(); if (entry.expiresAt > now) { recordCacheHit(); recordCacheTierHit('l1'); recordCacheSourceHit('redis'); return { ...entry, isStale: false, staleAgeMs: 0 }; }
              if (now <= entry.expiresAt + SWR_STALE_TTL_MS) { recordCacheHit(); recordCacheTierHit('l1'); recordCacheSourceHit('redis'); triggerBGRefresh(key, uuid, entry); return { ...entry, isStale: true, staleAgeMs: now - (entry.cachedAt || (entry.expiresAt - getAdpTtl())) }; }
              await cli.del(k);
            }
          }
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('[statsCache] L1 SWR read failed', message);
    }
  }
  if (shouldReadFromDb()) {
    const l2 = await getPFromDb(key, true);
    if (l2) {
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
        }).catch((e) => logger.warn('[statsCache] L1 backfill failed', e));
        
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
  }
  return null;
}

function triggerBGRefresh(key: string, uuid: string, entry: CacheEntry<MinimalPlayerStats>): void {
  if (bgLocks.has(key)) return;
  const prom = (async () => {
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
      logger.warn('[statsCache] background refresh failed for %s', uuid, error);
      recordCacheRefresh('fail');
    } finally {
      backgroundRefreshLocks.delete(key);
    }
  })();
  bgLocks.set(key, prom); void prom.catch(() => {});
}

export async function getManyPlayerStatsFromCacheWithSWR(ids: { key: string; uuid: string }[]): Promise<Map<string, any>> {
  const res = new Map<string, any>(); if (ids.length === 0) return res;
  if (!isRedisAvailable()) {
    return result;
  }

  const client = getRedisClient();
  if (!client || client.status !== 'ready') {
    return result;
  }

  const redisKeys = identifiers.map((i) => getCacheKey(i.key));

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
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('[statsCache] L1 batch read failed', message);
  }
  const cli = getRedisClient(); if (!cli || cli.status !== 'ready') return res;
  try {
    const vals = await cli.mget(...ids.map(i => `cache:${i.key}`));
    for (let i = 0; i < vals.length; i++) {
      if (!vals[i]) continue; let row: any; try { row = JSON.parse(vals[i]!); } catch { continue; }
      const entry = mapR<MinimalPlayerStats>(row); if (!entry) continue;
      const now = Date.now(); if (entry.expiresAt > now) { recordCacheHit(); recordCacheTierHit('l1'); recordCacheSourceHit('redis'); res.set(ids[i].key, { ...entry, isStale: false, staleAgeMs: 0 }); continue; }
      if (SWR_ENABLED && now <= entry.expiresAt + SWR_STALE_TTL_MS) { recordCacheHit(); recordCacheTierHit('l1'); recordCacheSourceHit('redis'); triggerBGRefresh(ids[i].key, ids[i].uuid, entry); res.set(ids[i].key, { ...entry, isStale: true, staleAgeMs: now - (entry.cachedAt || (entry.expiresAt - getAdpTtl())) }); }
    }
  } catch (e) {}
  const missing = ids.filter(i => !res.has(i.key));
  if (missing.length > 0 && shouldReadFromDb()) {
    const l2s = await getManyPFromDb(missing.map(m => m.key), true); const expK: string[] = [];
    for (const [k, e] of l2s) {
      const id = missing.find(m => m.key === k); if (!id) continue;
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
        }).catch((e) => logger.warn('[statsCache] L1 backfill failed', e));

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
          const { sql, params: delParams } = pool.formatInClause('cache_key', expiredKeys, 1);
          await pool.query(`DELETE FROM player_stats_cache WHERE ${sql}`, delParams);
        } catch (e) {
          logger.warn('[statsCache] failed to batch delete expired L2 entries', e);
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
  return res;
}

export async function setPlayerStatsL1(key: string, stats: MinimalPlayerStats, meta: CacheMetadata = {}): Promise<void> {
  const cli = getRedisClient(); if (!cli || cli.status !== 'ready') return;
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

    const redisKey = getCacheKey(key);
    await client.setex(redisKey, Math.ceil(ttlMs / 1000), data);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('[statsCache] setPlayerStatsL1 failed', message);
  }
}

export async function setPlayerStatsBoth(key: string, stats: MinimalPlayerStats, meta: CacheMetadata = {}): Promise<void> {
  await Promise.all([ setPInDb(key, stats, PLAYER_L2_TTL_MS, meta), setPlayerStatsL1(key, stats, meta) ]);
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
        logger.warn('[statsCache] IGN L1 backfill failed', e),
      );
    }
    return l2Entry;
  }

  recordCacheMiss('absent');
  return null;
}

export async function setIgnMapping(ign: string, uuid: string | null, nicked: boolean): Promise<void> {
  const ttl = getAdpTtl();
  await Promise.all([ setIMapInRedis(ign, { uuid, nicked }, ttl), setIMapInDb(ign, uuid, nicked, IGN_L2_TTL_MS) ]);
}

export async function deletePlayerStatsEntries(keys: string[]): Promise<number> {
  if (keys.length === 0) return 0;
  if (isRedisAvailable()) {
    const client = getRedisClient();
    if (client && client.status === 'ready') {
      try {
        const redisKeys = keys.map((key) => getCacheKey(key));
        await client.del(...redisKeys);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error('[statsCache] delete L1 stats failed', message);
      }
    }
  }
  await ensureInitialized();
  try {
    const { sql, params: delParams } = pool.formatInClause('cache_key', keys, 1);
    const result = await pool.query(`DELETE FROM player_stats_cache WHERE ${sql}`, delParams);
    markDbAccess();
    return result.rowCount;
  } catch (error) {
    logger.error('[statsCache] delete L2 stats failed', error);
    return 0;
  }
}

export async function deleteIgnMappings(igns: string[]): Promise<number> {
  if (igns.length === 0) return 0;
  if (isRedisAvailable()) {
    const client = getRedisClient();
    if (client && client.status === 'ready') {
      try {
        const redisKeys = igns.map((ign) => getCacheKey(buildIgnMappingKey(ign)));
        await client.del(...redisKeys);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error('[statsCache] delete L1 ign mappings failed', message);
      }
    }
  }
  await ensureInitialized();
  try {
    const { sql, params: delParams } = pool.formatInClause('ign', igns, 1);
    const result = await pool.query(`DELETE FROM ign_uuid_cache WHERE ${sql}`, delParams);
    markDbAccess();
    return result.rowCount;
  } catch (error) {
    logger.error('[statsCache] delete L2 ign mappings failed', error);
    return 0;
  }
}

export async function clearAllPlayerStatsCaches(): Promise<number> {
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
        logger.error('[statsCache] clear L1 caches failed', message);
      }
    }
  }
  await ensureInitialized();
  try {
    const statsResult = await pool.query('DELETE FROM player_stats_cache');
    const ignResult = await pool.query('DELETE FROM ign_uuid_cache');
    markDbAccess();
    return statsResult.rowCount + ignResult.rowCount;
  } catch (error) {
    logger.error('[statsCache] clear L2 caches failed', error);
    return deleted;
  }
}
