import Redis from 'ioredis';
import { createHmac } from 'node:crypto';
import {
    REDIS_URL,
    REDIS_COMMAND_TIMEOUT,
    REDIS_KEY_SALT,
    REDIS_STATS_BUCKET_SIZE_MS,
    REDIS_STATS_CACHE_TTL_MS,
    RATE_LIMIT_WINDOW_MS,
} from '../config';

// ---------------------------------------------------------------------------
// Client Initialization
// ---------------------------------------------------------------------------

let redis: Redis | null = null;

function getRedisClient(): Redis | null {
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
            console.error('[redis] connection error', err.message);
        });

        redis.on('connect', () => {
            console.info('[redis] connected');
        });

        redis.on('close', () => {
            console.warn('[redis] connection closed');
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

function hashIp(ip: string): string {
    const key = REDIS_KEY_SALT || 'levelhead-default-salt';
    const hash = createHmac('sha256', key).update(ip).digest('hex');
    // Use first 32 chars (128 bits) for collision resistance while keeping keys short
    return hash.slice(0, 32);
}

// ---------------------------------------------------------------------------
// Lua Scripts (Atomic Operations)
// ---------------------------------------------------------------------------

// Atomic increment with TTL set only on first creation
// ARGV[1] = windowMs, ARGV[2] = cost (amount to increment)
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

// ---------------------------------------------------------------------------
// Rate Limiting (Hybrid: In-Memory + Redis)
// ---------------------------------------------------------------------------

export interface RateLimitResult {
    count: number;
    ttl: number;
}

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

export async function incrementRateLimit(ip: string, windowMs: number, cost: number = 1): Promise<RateLimitResult | null> {
    const ipHash = hashIp(ip);
    const cacheKey = `rl:${ipHash}`;
    const now = Date.now();

    // Check local cache first
    let local = localRateLimits.get(cacheKey);

    // If we have a valid local entry in the current window
    if (local && (now - local.windowStart) < windowMs) {
        local.count += cost;

        // Decide if we need to sync to Redis
        const countDelta = local.count - local.lastSyncedCount;
        const timeSinceSync = now - local.lastSyncTime;
        const shouldSync = countDelta >= LOCAL_CACHE_SYNC_THRESHOLD || timeSinceSync >= LOCAL_CACHE_SYNC_INTERVAL_MS;

        if (shouldSync) {
            // Sync to Redis in background (don't block the response)
            void syncToRedis(cacheKey, windowMs, local).catch((err) => {
                console.error('[redis] background sync failed', err);
            });
        }

        return {
            count: local.count,
            ttl: Math.max(0, windowMs - (now - local.windowStart)),
        };
    }

    // No valid local entry - try Redis
    const client = getRedisClient();
    if (!client) {
        // No Redis, use pure in-memory
        if (!local || (now - local.windowStart) >= windowMs) {
            local = {
                count: cost,
                windowStart: now,
                lastSyncedCount: 0,
                lastSyncTime: now,
            };
        } else {
            local.count += cost;
        }

        // Enforce max cache size (LRU-style: delete oldest)
        if (localRateLimits.size >= LOCAL_CACHE_MAX_SIZE) {
            const firstKey = localRateLimits.keys().next().value;
            if (firstKey) localRateLimits.delete(firstKey);
        }

        localRateLimits.set(cacheKey, local);
        return {
            count: local.count,
            ttl: Math.max(0, windowMs - (now - local.windowStart)),
        };
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

        localRateLimits.set(cacheKey, local);

        return {
            count: result[0],
            ttl: result[1],
        };
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[redis] incrementRateLimit failed', message);

        // Fallback to local-only
        if (!local || (now - local.windowStart) >= windowMs) {
            local = { count: cost, windowStart: now, lastSyncedCount: 0, lastSyncTime: now };
        } else {
            local.count += cost;
        }
        localRateLimits.set(cacheKey, local);

        return {
            count: local.count,
            ttl: Math.max(0, windowMs - (now - local.windowStart)),
        };
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
        console.error('[redis] syncToRedis failed', message);
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
        console.error('[redis] trackGlobalStats failed', message);
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
        console.error('[redis] getGlobalStats failed', message);
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
        console.info('[redis] connection closed gracefully');
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

        let rateLimitKeys = 0;
        let statsKeys = 0;

        // Use SCAN to count keys by pattern (more efficient than KEYS)
        let cursor = '0';
        do {
            const [newCursor, keys] = await client.scan(cursor, 'MATCH', 'rl:*', 'COUNT', 100);
            cursor = newCursor;
            rateLimitKeys += keys.length;
        } while (cursor !== '0');

        cursor = '0';
        do {
            const [newCursor, keys] = await client.scan(cursor, 'MATCH', 'stats:*', 'COUNT', 100);
            cursor = newCursor;
            statsKeys += keys.length;
        } while (cursor !== '0');

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
}
