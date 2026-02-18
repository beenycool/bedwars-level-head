import Redis from 'ioredis';
import { createHmac } from 'node:crypto';
import {
    REDIS_URL,
    REDIS_COMMAND_TIMEOUT,
    REDIS_KEY_SALT,
    REDIS_STATS_BUCKET_SIZE_MS,
    REDIS_STATS_CACHE_TTL_MS,
    RATE_LIMIT_WINDOW_MS,
    RATE_LIMIT_REQUIRE_REDIS,
    RATE_LIMIT_FALLBACK_MODE,
} from '../config';
import { CacheEntry, CacheMetadata } from './cache';
import { logger } from '../util/logger';

// ---------------------------------------------------------------------------
// Client Initialization
// ---------------------------------------------------------------------------

let redis: Redis | null = null;

export function getRedisClient(): Redis | null {
    if (!REDIS_URL) {
        return null;
    }

    if (!redis) {
        redis = new Redis(REDIS_URL, {
            enableOfflineQueue: false,
            maxRetriesPerRequest: 1,
            commandTimeout: REDIS_COMMAND_TIMEOUT,
            lazyConnect: false,
            retryStrategy: (times) => {
                // Exponential backoff capped at 3s, only for reconnection (not per-request)
                return Math.min(times * 100, 3000);
            },
        });

        redis.on('error', (err) => {
            logger.error('[redis] connection error', err.message);
        });

        redis.on('connect', () => {
            logger.info('[redis] connected');
        });

        redis.on('close', () => {
            logger.warn('[redis] connection closed');
        });
    }

    return redis;
}

export function isRedisAvailable(): boolean {
    const client = getRedisClient();
    return client !== null && client.status === 'ready';
}



// ---------------------------------------------------------------------------
// IP Hashing
// ---------------------------------------------------------------------------

export function hashIp(ip: string): string {
    const hash = createHmac('sha256', REDIS_KEY_SALT).update(ip).digest('hex');
    // Use first 32 chars (128 bits) for collision resistance while keeping keys short
    return hash.slice(0, 32);
}

// ---------------------------------------------------------------------------
// Lua Scripts (Atomic Operations)
// ---------------------------------------------------------------------------

// Atomic increment with TTL set only on first creation
// ARGV[1] = windowMs, ARGV[2] = cost (amount to increment)
// Note: In Redis Lua, numeric comparisons work correctly because INCRBY returns a number
// and we convert ARGV[2] to a number with tonumber(). The TTL is set when current == cost,
// meaning this is the first increment for this key in the window.
const ATOMIC_INCR_SCRIPT = `
local cost = tonumber(ARGV[2]) or 1
local current = redis.call("INCRBY", KEYS[1], cost)
if current == cost then
  redis.call("PEXPIRE", KEYS[1], ARGV[1])
end
return {current, redis.call("PTTL", KEYS[1])}
`;

// Atomic bucket update: increments counter and adds to HLL, sets TTL only on creation
const ATOMIC_BUCKET_SCRIPT = `
local reqKey = KEYS[1]
local hllKey = KEYS[2]
local ttl = tonumber(ARGV[1])
local ipHash = ARGV[2]

local reqExists = redis.call("EXISTS", reqKey)
redis.call("INCR", reqKey)
if reqExists == 0 then
  redis.call("PEXPIRE", reqKey, ttl)
end

local hllExists = redis.call("EXISTS", hllKey)
redis.call("PFADD", hllKey, ipHash)
if hllExists == 0 then
  redis.call("PEXPIRE", hllKey, ttl)
end

return 1
`;

// Scan keyspace and count prefixes in one pass
// ARGV[1] = cursor, ARGV[2] = count
const COUNT_KEYS_SCRIPT = `
local cursor = ARGV[1]
local count = ARGV[2]
local result = redis.call("SCAN", cursor, "COUNT", count)
local next_cursor = result[1]
local keys = result[2]
local rl = 0
local stats = 0
local cache = 0

for i, key in ipairs(keys) do
  if string.sub(key, 1, 3) == "rl:" then
    rl = rl + 1
  elseif string.sub(key, 1, 6) == "stats:" then
    stats = stats + 1
  elseif string.sub(key, 1, 6) == "cache:" then
    cache = cache + 1
  end
end

return {next_cursor, rl, stats, cache}
`;

const REDIS_SCAN_BATCH_SIZE = 1000;
const REDIS_PURGE_UNLINK_BATCH_SIZE = 500;

// ---------------------------------------------------------------------------
// Rate Limiting (Hybrid: In-Memory + Redis)
// ---------------------------------------------------------------------------

// Track whether we're currently using fallback mode
let isInFallbackMode = false;
let fallbackModeActivatedAt: number | null = null;

export interface RateLimitFallbackState {
  isInFallbackMode: boolean;
  fallbackMode: 'deny' | 'allow' | 'memory' | null;
  activatedAt: string | null;
  requireRedis: boolean;
}

export function getRateLimitFallbackState(): RateLimitFallbackState {
  return {
    isInFallbackMode,
    fallbackMode: isInFallbackMode ? RATE_LIMIT_FALLBACK_MODE : null,
    activatedAt: fallbackModeActivatedAt ? new Date(fallbackModeActivatedAt).toISOString() : null,
    requireRedis: RATE_LIMIT_REQUIRE_REDIS,
  };
}

function activateFallbackMode(): void {
  if (!isInFallbackMode) {
    isInFallbackMode = true;
    fallbackModeActivatedAt = Date.now();
    logger.warn(`[rate-limit] FALLBACK MODE ACTIVATED: Using ${RATE_LIMIT_FALLBACK_MODE} mode (Redis unavailable). ` +
      `RATE_LIMIT_REQUIRE_REDIS=${RATE_LIMIT_REQUIRE_REDIS}. ` +
      `This means rate limits are ${RATE_LIMIT_FALLBACK_MODE === 'memory' ? 'per-instance (attackers can bypass by hitting different instances)' : RATE_LIMIT_FALLBACK_MODE === 'allow' ? 'DISABLED (all requests allowed)' : 'enforcing denial (503 errors)'}.`);
  }
}

function clearFallbackMode(): void {
  if (isInFallbackMode) {
    isInFallbackMode = false;
    const duration = fallbackModeActivatedAt ? Date.now() - fallbackModeActivatedAt : 0;
    fallbackModeActivatedAt = null;
    logger.info(`[rate-limit] Redis recovered, exiting fallback mode. Fallback was active for ${duration}ms`);
  }
}

function getFallbackRateLimitResult(
    cacheKey: string,
    windowMs: number,
    cost: number,
    now: number,
): RateLimitResult {
    switch (RATE_LIMIT_FALLBACK_MODE) {
        case 'deny':
            return RATE_LIMIT_DENY_ALL;
        case 'allow':
            return RATE_LIMIT_ALLOW_ALL;
        case 'memory':
        default:
            return getLocalRateLimitCount(cacheKey, windowMs, cost, now);
    }
}

// Special result indicating that the request should be allowed (fallback=allow mode)
export const RATE_LIMIT_ALLOW_ALL = Symbol('RATE_LIMIT_ALLOW_ALL');
// Special result indicating that the request should be denied (fallback=deny mode)
export const RATE_LIMIT_DENY_ALL = Symbol('RATE_LIMIT_DENY_ALL');

export type RateLimitResult = {
    count: number;
    ttl: number;
} | typeof RATE_LIMIT_ALLOW_ALL | typeof RATE_LIMIT_DENY_ALL | null;

// In-memory rate limit cache
interface LocalRateLimitEntry {
    count: number;
    windowStart: number;
    lastSyncedCount: number;
    lastSyncTime: number;
}

const localRateLimits = new Map<string, LocalRateLimitEntry>();
const LOCAL_CACHE_SYNC_INTERVAL_MS = 5000; // Sync to Redis every 5 seconds
const LOCAL_CACHE_SYNC_THRESHOLD = 10; // Or when count increases by 10
const LOCAL_CACHE_MAX_SIZE = 10000; // Max entries in local cache

// Cleanup old entries periodically
setInterval(() => {
    const now = Date.now();
    const windowMs = RATE_LIMIT_WINDOW_MS;
    for (const [key, entry] of localRateLimits) {
        if (now - entry.windowStart > windowMs) {
            localRateLimits.delete(key);
        }
    }
}, 60000).unref(); // Every minute

function getLocalRateLimitCount(cacheKey: string, windowMs: number, cost: number, now: number): { count: number; ttl: number } {
    let local = localRateLimits.get(cacheKey);
    const isNewEntry = !local || (now - local.windowStart) >= windowMs;

    if (isNewEntry) {
        local = {
            count: cost,
            windowStart: now,
            lastSyncedCount: 0,
            lastSyncTime: now,
        };
    } else {
        local!.count += cost;
    }

    // Enforce max cache size (FIFO: delete oldest-inserted entry)
    if (isNewEntry && localRateLimits.size >= LOCAL_CACHE_MAX_SIZE) {
        const firstKey = localRateLimits.keys().next().value;
        if (firstKey) localRateLimits.delete(firstKey);
    }

    localRateLimits.set(cacheKey, local!);
    return {
        count: local!.count,
        ttl: Math.max(0, windowMs - (now - local!.windowStart)),
    };
}

export async function incrementRateLimit(ip: string, windowMs: number, cost: number = 1): Promise<RateLimitResult> {
    const ipHash = hashIp(ip);
    const cacheKey = `rl:${ipHash}`;
    const now = Date.now();

    // Check local cache first
    let local = localRateLimits.get(cacheKey);

    // If we have a valid local entry in the current window
    if (local && (now - local.windowStart) < windowMs) {
        local!.count += cost;

        // Decide if we need to sync to Redis
        const countDelta = local.count - local.lastSyncedCount;
        const timeSinceSync = now - local.lastSyncTime;
        const shouldSync = countDelta >= LOCAL_CACHE_SYNC_THRESHOLD || timeSinceSync >= LOCAL_CACHE_SYNC_INTERVAL_MS;

        if (shouldSync) {
            // Sync to Redis in background (don't block the response)
            void syncToRedis(cacheKey, windowMs, local).catch((err) => {
                logger.error('[redis] background sync failed', err);
            });
        }

        return {
            count: local!.count,
            ttl: Math.max(0, windowMs - (now - local!.windowStart)),
        };
    }

    // No valid local entry - try Redis
    const client = getRedisClient();

    // Handle Redis unavailable scenarios
    if (!client || client.status !== 'ready') {
        // Redis is not available - handle according to configuration
        if (RATE_LIMIT_REQUIRE_REDIS) {
            activateFallbackMode();
            return getFallbackRateLimitResult(cacheKey, windowMs, cost, now);
        } else {
            // RATE_LIMIT_REQUIRE_REDIS=false: use in-memory silently (legacy behavior)
            return getLocalRateLimitCount(cacheKey, windowMs, cost, now);
        }
    }

    // Redis is available - clear fallback mode if we were in it
    if (isInFallbackMode) {
        clearFallbackMode();
    }

    try {
        const result = await client.eval(ATOMIC_INCR_SCRIPT, 1, cacheKey, windowMs.toString(), cost.toString()) as [number, number];

        // Store in local cache
        local = {
            count: result[0],
            windowStart: now - (windowMs - result[1]), // Estimate window start from TTL
            lastSyncedCount: result[0],
            lastSyncTime: now,
        };

        if (localRateLimits.size >= LOCAL_CACHE_MAX_SIZE) {
            const firstKey = localRateLimits.keys().next().value;
            if (firstKey) localRateLimits.delete(firstKey);
        }

        localRateLimits.set(cacheKey, local!);

        return {
            count: result[0],
            ttl: result[1],
        };
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error('[redis] incrementRateLimit failed', message);

        // Redis operation failed - handle according to configuration
        if (RATE_LIMIT_REQUIRE_REDIS) {
            activateFallbackMode();
            return getFallbackRateLimitResult(cacheKey, windowMs, cost, now);
        } else {
            // Legacy behavior: fallback to in-memory silently
            return getLocalRateLimitCount(cacheKey, windowMs, cost, now);
        }
    }
}

async function syncToRedis(key: string, windowMs: number, local: LocalRateLimitEntry): Promise<void> {
    const client = getRedisClient();
    if (!client) return;

    try {
        // Use INCRBY to add the delta since last sync
        const delta = local.count - local.lastSyncedCount;
        if (delta > 0) {
            await client.eval(
                `
                local current = redis.call("INCRBY", KEYS[1], ARGV[1])
                local ttl = redis.call("PTTL", KEYS[1])
                if ttl == -1 or ttl == -2 then
                    redis.call("PEXPIRE", KEYS[1], ARGV[2])
                end
                return current
                `,
                1,
                key,
                delta.toString(),
                windowMs.toString()
            );
        }
        local.lastSyncedCount = local.count;
        local.lastSyncTime = Date.now();
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error('[redis] syncToRedis failed', message);
    }
}

// Export for stats
export function getLocalCacheStats(): { size: number; maxSize: number } {
    return {
        size: localRateLimits.size,
        maxSize: LOCAL_CACHE_MAX_SIZE,
    };
}

// ---------------------------------------------------------------------------
// Global Stats Tracking (Bucketed)
// ---------------------------------------------------------------------------

function getCurrentBucket(): number {
    return Math.floor(Date.now() / REDIS_STATS_BUCKET_SIZE_MS);
}

function getBucketKeys(bucket: number): { reqKey: string; hllKey: string } {
    return {
        reqKey: `stats:req:${bucket}`,
        hllKey: `stats:au:${bucket}`,
    };
}

export async function trackGlobalStats(ip: string): Promise<void> {
    const client = getRedisClient();
    if (!client) {
        return;
    }

    try {
        const bucket = getCurrentBucket();
        const { reqKey, hllKey } = getBucketKeys(bucket);
        const ipHash = hashIp(ip);
        // TTL = window + 1 bucket to ensure we have full coverage
        const ttl = RATE_LIMIT_WINDOW_MS + REDIS_STATS_BUCKET_SIZE_MS;

        await client.eval(ATOMIC_BUCKET_SCRIPT, 2, reqKey, hllKey, ttl.toString(), ipHash);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error('[redis] trackGlobalStats failed', message);
    }
}

// ---------------------------------------------------------------------------
// Global Stats Retrieval (with In-Process Cache)
// ---------------------------------------------------------------------------

interface GlobalStatsCache {
    value: { requestCount: number; activeUsers: number } | null;
    expiresAt: number;
}

const statsCache: GlobalStatsCache = {
    value: null,
    expiresAt: 0,
};

// Cache heavy stats operations (SCAN) for 10 seconds
const HEAVY_STATS_TTL_MS = 10000;

interface InMemoryCache<T> {
    value: T | null;
    expiresAt: number;
}

const redisStatsCache: InMemoryCache<RedisStats> = { value: null, expiresAt: 0 };
const redisCacheStatsCache: InMemoryCache<RedisCacheStats> = { value: null, expiresAt: 0 };

interface KeyCounts {
  rateLimitKeys: number;
  statsKeys: number;
  cacheKeys: number;
}

async function withMemoryCache<T>(
    cache: InMemoryCache<T>,
    ttlMs: number,
    fetchFn: () => Promise<T>,
): Promise<T> {
    const now = Date.now();
    if (cache.value !== null && now < cache.expiresAt) {
        return cache.value;
    }

    const result = await fetchFn();
    cache.value = result;
    cache.expiresAt = Date.now() + ttlMs;
    return result;
}

// Background refresher for key counts (avoids blocking requests)
let cachedKeyCounts: KeyCounts = { rateLimitKeys: 0, statsKeys: 0, cacheKeys: 0 };
let keyCountRefreshInterval: NodeJS.Timeout | null = null;
let isRefreshingKeyCounts = false;

// Bolt: Decoupled heavy scan from request path
async function refreshKeyCounts(): Promise<void> {
  if (isRefreshingKeyCounts) return;
  isRefreshingKeyCounts = true;

  try {
    const client = getRedisClient();
    if (!client || client.status !== 'ready') {
      return;
    }

    let cursor = '0';
    let tempRateLimitKeys = 0;
    let tempStatsKeys = 0;
    let tempCacheKeys = 0;

    do {
      // Use Lua script to scan and count in one pass
      const result = await client.eval(
        COUNT_KEYS_SCRIPT,
        0,
        cursor,
        String(REDIS_SCAN_BATCH_SIZE),
      ) as [string, number, number, number];
      const [nextCursor, rl, stats, cache] = result;

      cursor = nextCursor;
      tempRateLimitKeys += rl;
      tempStatsKeys += stats;
      tempCacheKeys += cache;
    } while (cursor !== '0');

    cachedKeyCounts = {
      rateLimitKeys: tempRateLimitKeys,
      statsKeys: tempStatsKeys,
      cacheKeys: tempCacheKeys,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('[redis] refreshKeyCounts failed', message);
  } finally {
    isRefreshingKeyCounts = false;
  }
}

export function startKeyCountRefresher(): void {
  if (keyCountRefreshInterval) return;

  // Initial refresh (fire and forget)
  void refreshKeyCounts().catch(() => {});

  keyCountRefreshInterval = setInterval(() => {
    void refreshKeyCounts().catch((err) => {
      logger.error('[redis] key count refresh interval error', err);
    });
  }, HEAVY_STATS_TTL_MS);
  keyCountRefreshInterval.unref();
}

export function stopKeyCountRefresher(): void {
  if (keyCountRefreshInterval) {
    clearInterval(keyCountRefreshInterval);
    keyCountRefreshInterval = null;
  }
}

function getKeyCounts(): KeyCounts {
  return cachedKeyCounts;
}

export async function getGlobalStats(windowMs: number): Promise<{ requestCount: number; activeUsers: number }> {
    const now = Date.now();

    // Return cached value if still valid
    if (statsCache.value !== null && now < statsCache.expiresAt) {
        return statsCache.value;
    }

    const client = getRedisClient();
    if (!client) {
        return { requestCount: 0, activeUsers: 0 };
    }

    try {
        const currentBucket = getCurrentBucket();
        const bucketsNeeded = Math.ceil(windowMs / REDIS_STATS_BUCKET_SIZE_MS);

        const reqKeys: string[] = [];
        const hllKeys: string[] = [];

        for (let i = 0; i < bucketsNeeded; i++) {
            const bucket = currentBucket - i;
            const { reqKey, hllKey } = getBucketKeys(bucket);
            reqKeys.push(reqKey);
            hllKeys.push(hllKey);
        }

        // Fetch request counts
        const reqValues = await client.mget(...reqKeys);
        let requestCount = 0;
        for (const val of reqValues) {
            if (val !== null) {
                const parsed = parseInt(val, 10);
                if (!isNaN(parsed)) {
                    requestCount += parsed;
                }
            }
        }

        // Get unique active users via HLL union
        let activeUsers = 0;
        if (hllKeys.length > 0) {
            activeUsers = await client.pfcount(...hllKeys);
        }

        const result = { requestCount, activeUsers };

        // Cache the result
        statsCache.value = result;
        statsCache.expiresAt = now + REDIS_STATS_CACHE_TTL_MS;

        return result;
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error('[redis] getGlobalStats failed', message);
        return { requestCount: 0, activeUsers: 0 };
    }
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

export async function closeRedis(): Promise<void> {
    if (redis) {
        await redis.quit();
        redis = null;
        logger.info('[redis] connection closed gracefully');
    }
}

// ---------------------------------------------------------------------------
// Stats for Dashboard
// ---------------------------------------------------------------------------

export interface RedisStats {
    connected: boolean;
    memoryUsed: string;
    memoryUsedBytes: number;
    memoryMax: string;
    memoryPercent: number;
    totalKeys: number;
    rateLimitKeys: number;
    statsKeys: number;
    localCacheSize: number;
    localCacheMaxSize: number;
}

export async function getRedisStats(): Promise<RedisStats> {
    return withMemoryCache(redisStatsCache, HEAVY_STATS_TTL_MS, async () => {
        const localCache = getLocalCacheStats();
        const defaultStats: RedisStats = {
            connected: false,
            memoryUsed: 'N/A',
            memoryUsedBytes: 0,
            memoryMax: 'N/A',
            memoryPercent: 0,
            totalKeys: 0,
            rateLimitKeys: 0,
            statsKeys: 0,
            localCacheSize: localCache.size,
            localCacheMaxSize: localCache.maxSize,
        };

        const client = getRedisClient();
        if (!client || client.status !== 'ready') {
            return defaultStats;
        }

        try {
            // Get memory info
            const info = await client.info('memory');
            const memoryMatch = info.match(/used_memory:(\d+)/);
            const memoryHumanMatch = info.match(/used_memory_human:([^\r\n]+)/);
            const maxMemoryMatch = info.match(/maxmemory:(\d+)/);
            const maxMemoryHumanMatch = info.match(/maxmemory_human:([^\r\n]+)/);

            const memoryUsedBytes = memoryMatch ? parseInt(memoryMatch[1], 10) : 0;
            const memoryUsed = memoryHumanMatch ? memoryHumanMatch[1].trim() : `${(memoryUsedBytes / 1024 / 1024).toFixed(2)}M`;
            const maxMemoryBytes = maxMemoryMatch ? parseInt(maxMemoryMatch[1], 10) : 0;
            const memoryMax = maxMemoryHumanMatch ? maxMemoryHumanMatch[1].trim() : (maxMemoryBytes > 0 ? `${(maxMemoryBytes / 1024 / 1024).toFixed(2)}M` : 'Unlimited');

            // Calculate memory percentage (assume 30MB if no max set)
            const effectiveMax = maxMemoryBytes > 0 ? maxMemoryBytes : 30 * 1024 * 1024;
            const memoryPercent = Math.min(100, (memoryUsedBytes / effectiveMax) * 100);

            // Count keys by pattern
            const totalKeys = await client.dbsize();

            // Bolt: Optimized to count all prefixes in one pass
            const { rateLimitKeys, statsKeys } = getKeyCounts();

            return {
                connected: true,
                memoryUsed,
                memoryUsedBytes,
                memoryMax,
                memoryPercent,
                totalKeys,
                rateLimitKeys,
                statsKeys,
                localCacheSize: localCache.size,
                localCacheMaxSize: localCache.maxSize,
            };
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            logger.error('[redis] getRedisStats failed', message);
            return defaultStats;
        }
    });
}

// ---------------------------------------------------------------------------
// Player Cache (Moved from PostgreSQL to Redis)
// ---------------------------------------------------------------------------

interface RedisCacheRow {
    payload: unknown;
    expires_at: number;
    etag: string | null;
    last_modified: number | string | null;
    source: string | null;
}

function mapRowToCacheEntry<T>(row: RedisCacheRow): CacheEntry<T> | null {
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

    const source = row.source;
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

export async function getPlayerCacheEntry<T>(key: string): Promise<CacheEntry<T> | null> {
    const client = getRedisClient();
    if (!client || client.status !== 'ready') {
        return null;
    }

    try {
        // Redis key pattern: cache:{key} storing JSON: { payload, expires_at, etag, last_modified, source }
        const redisKey = `cache:${key}`;
        const data = await client.get(redisKey);

        if (!data) {
            return null;
        }

        let row: RedisCacheRow;
        try {
            row = JSON.parse(data) as RedisCacheRow;
        } catch {
            // Invalid JSON, delete the entry
            await client.del(redisKey);
            return null;
        }

        const entry = mapRowToCacheEntry<T>(row);
        if (!entry) {
            return null;
        }

        const now = Date.now();
        if (entry.expiresAt <= now) {
            // Expired, clean up
            await client.del(redisKey);
            return null;
        }

        return entry;
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error('[redis] getPlayerCacheEntry failed', message);
        return null;
    }
}

export async function setPlayerCacheEntry<T>(
    key: string,
    value: T,
    ttlMs: number,
    metadata: CacheMetadata = {},
): Promise<void> {
    const client = getRedisClient();
    if (!client || client.status !== 'ready') {
        return;
    }

    try {
        const expiresAt = Date.now() + ttlMs;

        const data = JSON.stringify({
            payload: value,
            expires_at: expiresAt,
            etag: metadata.etag ?? null,
            last_modified: metadata.lastModified ?? null,
            source: metadata.source ?? null,
        });

        const redisKey = `cache:${key}`;
        await client.setex(redisKey, Math.ceil(ttlMs / 1000), data);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error('[redis] setPlayerCacheEntry failed', message);
    }
}

export async function clearPlayerCacheEntry(key: string): Promise<void> {
    const client = getRedisClient();
    if (!client || client.status !== 'ready') {
        return;
    }

    try {
        const redisKey = `cache:${key}`;
        await client.del(redisKey);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error('[redis] clearPlayerCacheEntry failed', message);
    }
}

export async function clearAllPlayerCacheEntries(): Promise<number> {
    const client = getRedisClient();
    if (!client || client.status !== 'ready') {
        return 0;
    }

    try {
        let cursor = '0';
        let deletedCount = 0;

        do {
            const [newCursor, keys] = await client.scan(cursor, 'MATCH', 'cache:*', 'COUNT', 1000);
            cursor = newCursor;

            if (keys.length > 0) {
                for (let i = 0; i < keys.length; i += REDIS_PURGE_UNLINK_BATCH_SIZE) {
                    const chunk = keys.slice(i, i + REDIS_PURGE_UNLINK_BATCH_SIZE);
                    try {
                        deletedCount += await client.unlink(...chunk);
                    } catch {
                        deletedCount += await client.del(...chunk);
                    }
                }
            }
        } while (cursor !== '0');

        return deletedCount;
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error('[redis] clearAllPlayerCacheEntries failed', message);
        return 0;
    }
}

export async function deletePlayerCacheEntries(keys: string[]): Promise<number> {
    const client = getRedisClient();
    if (!client || client.status !== 'ready') {
        return 0;
    }

    if (keys.length === 0) {
        return 0;
    }

    try {
        const redisKeys = keys.map((key) => `cache:${key}`);
        const result = await client.del(...redisKeys);
        return result;
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error('[redis] deletePlayerCacheEntries failed', message);
        return 0;
    }
}

export interface RedisCacheStats {
    totalKeys: number;
    cacheKeys: number;
    memoryUsedBytes: number;
    memoryUsed: string;
    memoryMax: string;
    memoryPercent: number;
}

export async function getRedisCacheStats(): Promise<RedisCacheStats> {
    return withMemoryCache(redisCacheStatsCache, HEAVY_STATS_TTL_MS, async () => {
        const client = getRedisClient();
        if (!client || client.status !== 'ready') {
            return {
                totalKeys: 0,
                cacheKeys: 0,
                memoryUsedBytes: 0,
                memoryUsed: 'N/A',
                memoryMax: 'N/A',
                memoryPercent: 0,
            };
        }

        try {
            // Get memory info
            const info = await client.info('memory');
            const memoryMatch = info.match(/used_memory:(\d+)/);
            const memoryHumanMatch = info.match(/used_memory_human:([^\r\n]+)/);
            const maxMemoryMatch = info.match(/maxmemory:(\d+)/);
            const maxMemoryHumanMatch = info.match(/maxmemory_human:([^\r\n]+)/);

            const memoryUsedBytes = memoryMatch ? parseInt(memoryMatch[1], 10) : 0;
            const memoryUsed = memoryHumanMatch ? memoryHumanMatch[1].trim() : `${(memoryUsedBytes / 1024 / 1024).toFixed(2)}M`;
            const maxMemoryBytes = maxMemoryMatch ? parseInt(maxMemoryMatch[1], 10) : 0;
            const memoryMax = maxMemoryHumanMatch ? maxMemoryHumanMatch[1].trim() : (maxMemoryBytes > 0 ? `${(maxMemoryBytes / 1024 / 1024).toFixed(2)}M` : 'Unlimited');

            // Calculate memory percentage
            const effectiveMax = maxMemoryBytes > 0 ? maxMemoryBytes : 30 * 1024 * 1024;
            const memoryPercent = Math.min(100, (memoryUsedBytes / effectiveMax) * 100);

            // Count total keys and cache keys
            const totalKeys = await client.dbsize();

            // Bolt: Optimized to count all prefixes in one pass
            const { cacheKeys } = getKeyCounts();

            return {
                totalKeys,
                cacheKeys,
                memoryUsedBytes,
                memoryUsed,
                memoryMax,
                memoryPercent,
            };
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            logger.error('[redis] getRedisCacheStats failed', message);
            return {
                totalKeys: 0,
                cacheKeys: 0,
                memoryUsedBytes: 0,
                memoryUsed: 'N/A',
                memoryMax: 'N/A',
                memoryPercent: 0,
            };
        }
    });
}
