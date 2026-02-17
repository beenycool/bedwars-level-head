import { Redis } from 'ioredis';
import {
    REDIS_URL,
    REDIS_COMMAND_TIMEOUT,
    REDIS_KEY_SALT,
    REDIS_STATS_BUCKET_SIZE_MS,
    REDIS_STATS_CACHE_TTL_MS,
    RATE_LIMIT_REQUIRE_REDIS,
} from '../config';
import { createHash } from 'node:crypto';
import type { CacheEntry, CacheMetadata } from './cache';

let redis: Redis | null = null;
let redisUrl = REDIS_URL;

export function setRedisUrl(url: string): void {
    redisUrl = url;
    if (redis) {
        redis.disconnect();
        redis = null;
    }
}

export function getRedisClient(): Redis | null {
    if (!redis && redisUrl) {
        try {
            redis = new Redis(redisUrl, {
                commandTimeout: REDIS_COMMAND_TIMEOUT,
                maxRetriesPerRequest: 1,
                retryStrategy: (times) => {
                    const delay = Math.min(times * 100, 3000);
                    return delay;
                },
                // Add connectTimeout to avoid hanging indefinitely
                connectTimeout: 5000,
            });

            redis.on('error', (err) => {
                // Silently handle connection errors to prevent app crashes
                // Middleware will handle fallback to in-memory/allow
                if (err instanceof Error) {
                    const msg = err.message;
                    if (msg.includes('ECONNREFUSED')) {
                        // Suppress noisy connection refused logs if we expect them
                    } else {
                        console.error('[redis] client error:', msg);
                    }
                }
            });
        } catch (err) {
            console.error('[redis] failed to initialize client', err);
            redis = null;
        }
    }
    return redis;
}

export function isRedisAvailable(): boolean {
    const client = getRedisClient();
    return client !== null && client.status === 'ready';
}

// ---------------------------------------------------------------------------
// Rate Limiting Lua Scripts
// ---------------------------------------------------------------------------

/**
 * Atomic Increment with TTL
 * ARGV[1] = bucket key
 * ARGV[2] = window in ms
 * ARGV[3] = increment amount (cost)
 * ARGV[4] = unique identifier for HLL (e.g. IP hash)
 * ARGV[5] = HLL key for global stats
 */
const INCREMENT_SCRIPT = `
local reqKey = ARGV[1]
local ttl = tonumber(ARGV[2])
local cost = tonumber(ARGV[3])
local ipHash = ARGV[4]
local hllKey = ARGV[5]

local current = redis.call("INCRBY", reqKey, cost)
if current == cost then
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
    fallbackMode: (process.env.RATE_LIMIT_FALLBACK_MODE as any) ?? 'memory',
    activatedAt: fallbackModeActivatedAt ? new Date(fallbackModeActivatedAt).toISOString() : null,
    requireRedis: RATE_LIMIT_REQUIRE_REDIS,
  };
}

// In-memory fallback for rate limiting when Redis is down
interface MemoryBucket {
    count: number;
    expiresAt: number;
}
const memoryRateLimitBuckets = new Map<string, MemoryBucket>();

// Cleanup memory buckets periodically
setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of memoryRateLimitBuckets.entries()) {
        if (now > bucket.expiresAt) {
            memoryRateLimitBuckets.delete(key);
        }
    }
}, 60000).unref();

export type RateLimitResult = { count: number; ttl: number } | null | string;
export const RATE_LIMIT_DENY_ALL = 'DENY_ALL';
export const RATE_LIMIT_ALLOW_ALL = 'ALLOW_ALL';

/**
 * Atomic increment of a rate limit bucket.
 * Falls back to in-memory limiting if Redis is unavailable.
 */
export async function incrementRateLimit(
    key: string,
    windowMs: number,
    cost: number = 1,
): Promise<RateLimitResult> {
    const client = getRedisClient();
    const redisKey = `rl:${key}`;
    const now = Date.now();

    if (!client || client.status !== 'ready') {
        // Handle Redis failure
        if (!isInFallbackMode) {
          isInFallbackMode = true;
          fallbackModeActivatedAt = now;
          console.error('[redis] Redis unavailable, entering rate limit fallback mode');
        }

        const mode = process.env.RATE_LIMIT_FALLBACK_MODE?.toLowerCase() ?? 'memory';
        if (mode === 'deny') return RATE_LIMIT_DENY_ALL;
        if (mode === 'allow') return RATE_LIMIT_ALLOW_ALL;

        // Default: 'memory' - basic per-instance limiting
        const bucket = memoryRateLimitBuckets.get(redisKey);
        if (bucket && now < bucket.expiresAt) {
            bucket.count += cost;
            return { count: bucket.count, ttl: bucket.expiresAt - now };
        } else {
            const expiresAt = now + windowMs;
            memoryRateLimitBuckets.set(redisKey, { count: cost, expiresAt });
            return { count: cost, ttl: windowMs };
        }
    }

    // Redis is available, recover from fallback if necessary
    if (isInFallbackMode) {
      isInFallbackMode = false;
      fallbackModeActivatedAt = null;
      console.info('[redis] Redis re-established, exiting rate limit fallback mode');
    }

    try {
        // Hash IP for HLL stats
        const ipHash = createHash('sha256')
            .update(key + REDIS_KEY_SALT)
            .digest('hex')
            .slice(0, 16);

        // Calculate global stats bucket (e.g., stats:hll:1625097600000)
        const statsBucket = Math.floor(now / REDIS_STATS_BUCKET_SIZE_MS) * REDIS_STATS_BUCKET_SIZE_MS;
        const hllKey = `stats:hll:${statsBucket}`;

        // Single-trip execution using Lua
        await client.eval(
            INCREMENT_SCRIPT,
            0,
            redisKey,
            String(windowMs),
            String(cost),
            ipHash,
            hllKey,
        );

        const [count, ttl] = await Promise.all([
            client.get(redisKey),
            client.pttl(redisKey),
        ]);

        return {
            count: parseInt(count || '0', 10),
            ttl: Math.max(0, ttl),
        };
    } catch (err) {
        console.error('[redis] incrementRateLimit failed', err);
        return null;
    }
}

/**
 * Tracks unique client IPs for global statistics without enforcing a limit.
 */
export async function trackGlobalStats(clientIp: string): Promise<void> {
    const client = getRedisClient();
    if (!client || client.status !== 'ready') return;

    try {
        const now = Date.now();
        const ipHash = createHash('sha256')
            .update(clientIp + REDIS_KEY_SALT)
            .digest('hex')
            .slice(0, 16);

        const statsBucket = Math.floor(now / REDIS_STATS_BUCKET_SIZE_MS) * REDIS_STATS_BUCKET_SIZE_MS;
        const hllKey = `stats:hll:${statsBucket}`;

        await client.pfadd(hllKey, ipHash);
        await client.pexpire(hllKey, 24 * 60 * 60 * 1000); // 24h retention
    } catch (err) {
        // Silent fail for stats
    }
}

// ---------------------------------------------------------------------------
// Monitoring & Diagnostics
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
let cachedCacheVersion = '1';
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

    // Fetch cache version alongside key counts
    const versionPromise = client.get('cache_version');

    let cursor = '0';
    let tempRateLimitKeys = 0;
    let tempStatsKeys = 0;
    let tempCacheKeys = 0;

    const [version] = await Promise.all([versionPromise]);
    if (version) {
      cachedCacheVersion = version;
    }

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
      tempRateLimitKeys += Number(rl);
      tempStatsKeys += Number(stats);
      tempCacheKeys += Number(cache);
    } while (cursor !== '0');

    cachedKeyCounts = {
      rateLimitKeys: tempRateLimitKeys,
      statsKeys: tempStatsKeys,
      cacheKeys: tempCacheKeys,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[redis] refreshKeyCounts failed', message);
  } finally {
    isRefreshingKeyCounts = false;
  }
}

/**
 * Returns a versioned cache key.
 * This implements "namespace versioning" for O(1) mass cache invalidation.
 */
export function getCacheKey(key: string): string {
  return `cache:v${cachedCacheVersion}:${key}`;
}

/**
 * Increments the global cache version in Redis.
 * This effectively invalidates all existing cache entries in O(1) time.
 */
export async function incrementCacheVersion(): Promise<number> {
  const client = getRedisClient();
  if (!client || client.status !== 'ready') {
    return 0;
  }

  try {
    const newVersion = await client.incr('cache_version');
    cachedCacheVersion = String(newVersion);
    console.info(`[redis] Cache version incremented to v${newVersion} (mass invalidation)`);
    return newVersion;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[redis] incrementCacheVersion failed', message);
    return 0;
  }
}

export function startKeyCountRefresher(): void {
  if (keyCountRefreshInterval) return;

  // Initial refresh (fire and forget)
  void refreshKeyCounts().catch(() => {});

  keyCountRefreshInterval = setInterval(() => {
    void refreshKeyCounts().catch((err) => {
      console.error('[redis] key count refresh interval error', err);
    });
  }, 10000); // Refresh every 10s
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

export async function getRedisStats(): Promise<RedisStats> {
    const client = getRedisClient();
    const localCache = (client as any)?.localCache as { size: number; maxSize: number } ?? { size: 0, maxSize: 0 };
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

    if (!client || client.status !== 'ready') {
        return defaultStats;
    }

    return withMemoryCache(redisStatsCache, REDIS_STATS_CACHE_TTL_MS, async () => {
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
            console.error('[redis] getRedisStats failed', message);
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
        const redisKey = getCacheKey(key);
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
        console.error('[redis] getPlayerCacheEntry failed', message);
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

        const redisKey = getCacheKey(key);
        await client.setex(redisKey, Math.ceil(ttlMs / 1000), data);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[redis] setPlayerCacheEntry failed', message);
    }
}

export async function clearPlayerCacheEntry(key: string): Promise<void> {
    const client = getRedisClient();
    if (!client || client.status !== 'ready') {
        return;
    }

    try {
        const redisKey = getCacheKey(key);
        await client.del(redisKey);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[redis] clearPlayerCacheEntry failed', message);
    }
}

export async function clearAllPlayerCacheEntries(): Promise<number> {
    // Mass invalidation using namespace versioning (O(1))
    const newVersion = await incrementCacheVersion();
    return newVersion > 0 ? -1 : 0; // Return -1 to indicate "all" invalidated without counting
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
        const redisKeys = keys.map((key) => getCacheKey(key));
        const result = await client.del(...redisKeys);
        return result;
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[redis] deletePlayerCacheEntries failed', message);
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
            console.error('[redis] getRedisCacheStats failed', message);
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
