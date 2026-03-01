import { pool, ensureInitialized } from './cache';
import { DatabaseType } from './database/adapter';
import { HYPIXEL_API_CALL_WINDOW_MS } from '../config';
import { logger } from '../util/logger';
import { getRedisClient, isRedisAvailable } from './redis';

const MAX_BUFFER_SIZE = 100;
const MAX_HARD_CAP = 10_000;
const FLUSH_INTERVAL_MS = 5000;
const MAX_RETRIES = 3;
const MAX_AGE_MS = 2 * HYPIXEL_API_CALL_WINDOW_MS;
const REDIS_ROLLING_KEY = 'hypixel_api_calls_rolling';
const REDIS_ROLLING_TTL_SECONDS = Math.ceil((HYPIXEL_API_CALL_WINDOW_MS * 2) / 1000);

interface BufferedCall {
  uuid: string;
  calledAt: number;
  retryCount: number;
  createdAt: number;
}

const hypixelCallBuffer: BufferedCall[] = [];
// inflightBatch is module-level so getHypixelCallCount can include it
const inflightBatch: BufferedCall[] = [];
// inflightOffset tracks how many items in inflightBatch have been successfully written to DB
// but not yet removed from the array (to avoid O(N) splice in the loop).
let inflightOffset = 0;
let flushPromise: Promise<void> | null = null;
let flushInterval: NodeJS.Timeout | null = null;

// Cache the last generated INSERT query to avoid O(N) string generation
let cachedQuery: { count: number; type: DatabaseType; sql: string } | null = null;

function buildRedisRollingMember(uuid: string, calledAt: number): string {
  const nonce = Math.random().toString(36).slice(2);
  return `${uuid}:${calledAt}:${nonce}`;
}

async function recordHypixelCallInRedis(uuid: string, calledAt: number): Promise<void> {
  if (!isRedisAvailable()) {
    return;
  }

  const client = getRedisClient();
  if (!client) {
    return;
  }

  const cutoff = calledAt - HYPIXEL_API_CALL_WINDOW_MS;
  const member = buildRedisRollingMember(uuid, calledAt);

  try {
    // Optimized: Use pipeline to batch commands and reduce network round-trips
    const pipeline = client.pipeline();
    pipeline.zadd(REDIS_ROLLING_KEY, calledAt, member);
    pipeline.zremrangebyscore(REDIS_ROLLING_KEY, '-inf', cutoff);
    pipeline.expire(REDIS_ROLLING_KEY, REDIS_ROLLING_TTL_SECONDS);
    await pipeline.exec();
  } catch (error) {
    logger.warn('[hypixelTracker] Failed to update Redis rolling counter', error);
  }
}

async function flushHypixelCallBuffer(): Promise<void> {
  if (flushPromise) {
    return flushPromise;
  }

  if (hypixelCallBuffer.length === 0) {
    return;
  }

  flushPromise = (async () => {
    try {
      // Move buffer to inflight
      inflightBatch.push(...hypixelCallBuffer);
      hypixelCallBuffer.length = 0;

      await ensureInitialized();

      const maxParams = pool.type === DatabaseType.POSTGRESQL ? 65000 : 2000;
      const maxRecordsPerChunk = Math.floor(maxParams / 2);

      // Process chunks from inflightBatch using inflightOffset to avoid O(N) splice inside the loop
      while (inflightOffset < inflightBatch.length) {
        const chunkEnd = Math.min(inflightOffset + maxRecordsPerChunk, inflightBatch.length);
        const chunk = inflightBatch.slice(inflightOffset, chunkEnd);

        // Optimized from flatMap to reduce array allocations
        const PARAMS_PER_RECORD = 2;
        const params = new Array(chunk.length * PARAMS_PER_RECORD);
        for (let i = 0; i < chunk.length; i++) {
          params[i * PARAMS_PER_RECORD] = chunk[i].calledAt;
          params[i * PARAMS_PER_RECORD + 1] = chunk[i].uuid;
        }

        let sql: string;
        if (cachedQuery && cachedQuery.count === chunk.length && cachedQuery.type === pool.type) {
          sql = cachedQuery.sql;
        } else {
          const placeholders = chunk.map((_, i) => `($${i * 2 + 1}, $${i * 2 + 2})`).join(', ');
          sql = `INSERT INTO hypixel_api_calls (called_at, uuid) VALUES ${placeholders}`;
          cachedQuery = { count: chunk.length, type: pool.type, sql };
        }

        try {
          await pool.query(sql, params);
          // Success: advance offset. Items before offset are in DB; items at/after offset are pending.
          inflightOffset += chunk.length;
        } catch (error) {
          logger.error('[hypixelTracker] Failed to flush chunk, re-queueing remaining items', error);
          // Stop processing further chunks on error to preserve order/integrity
          break;
        }
      }
    } finally {
      // Clean up successfully processed items in one single operation
      if (inflightOffset > 0) {
        if (inflightOffset === inflightBatch.length) {
          inflightBatch.length = 0;
        } else {
          inflightBatch.splice(0, inflightOffset);
        }
        inflightOffset = 0;
      }

      // If items remain (due to error), filter them for retries and put them back in the main buffer
      if (inflightBatch.length > 0) {
        const now = Date.now();
        const eligible = inflightBatch.filter(item => {
          item.retryCount++;
          const age = now - item.createdAt;
          return item.retryCount <= MAX_RETRIES && age <= MAX_AGE_MS;
        });

        if (eligible.length > 0) {
          hypixelCallBuffer.unshift(...eligible);
        }
        inflightBatch.length = 0;
      }
      flushPromise = null;
    }
  })();

  return flushPromise;
}

export async function recordHypixelApiCall(uuid: string, calledAt: number = Date.now()): Promise<void> {
  await recordHypixelCallInRedis(uuid, calledAt);

  // Backpressure: If buffer is full, wait for current flush to complete
  if (hypixelCallBuffer.length >= MAX_HARD_CAP) {
    if (flushPromise) {
      await flushPromise;
    } else {
      await flushHypixelCallBuffer();
    }
  }

  hypixelCallBuffer.push({
    uuid,
    calledAt,
    retryCount: 0,
    createdAt: Date.now()
  });

  if (hypixelCallBuffer.length >= MAX_BUFFER_SIZE) {
    void flushHypixelCallBuffer().catch((error) => {
      logger.error('[hypixelTracker] Flush failed', error);
    });
  }

  if (!flushInterval) {
    flushInterval = setInterval(() => {
      void flushHypixelCallBuffer().catch((error) => {
        logger.error('[hypixelTracker] Flush interval failed', error);
      });
    }, FLUSH_INTERVAL_MS);
    
    if (typeof flushInterval.unref === 'function') {
      flushInterval.unref();
    }
  }
}

export async function getHypixelCallCount(
  windowMs: number = HYPIXEL_API_CALL_WINDOW_MS,
  now: number = Date.now(),
): Promise<number> {
  if (isRedisAvailable()) {
    const client = getRedisClient();
    if (client) {
      const cutoff = now - windowMs;
      try {
        const count = await client.zcount(REDIS_ROLLING_KEY, cutoff, '+inf');
        if (Number.isFinite(count)) {
          return Number(count);
        }
      } catch (error) {
        logger.warn('[hypixelTracker] Redis zcount failed, falling back to SQL count', error);
      }
    }
  }

  await ensureInitialized();
  const cutoff = now - windowMs;

  // Snapshot memory state before async DB query to avoid race conditions.
  const snapshotOffset = inflightOffset;
  const snapshotInflight = [...inflightBatch];
  const snapshotBuffer = [...hypixelCallBuffer];

  const result = await pool.query<{ count: string | number }>(
    `
    SELECT COUNT(*) AS count
    FROM hypixel_api_calls
    WHERE called_at >= $1
    `,
    [cutoff],
  );

  const bufferCount = snapshotBuffer.filter((item) => item.calledAt >= cutoff).length;

  // Count items that were pending in memory at the time of the snapshot.
  // We use snapshotOffset because anything before that offset is presumed to be in the DB.
  let inflightCount = 0;
  for (let i = snapshotOffset; i < snapshotInflight.length; i++) {
    if (snapshotInflight[i].calledAt >= cutoff) {
      inflightCount++;
    }
  }

  const rawValue = result.rows[0]?.count ?? '0';
  const parsed = typeof rawValue === 'string' ? Number.parseInt(rawValue, 10) : Number(rawValue);
  const dbCount = Number.isFinite(parsed) ? parsed : 0;

  return dbCount + bufferCount + inflightCount;
}

export async function shutdown(): Promise<void> {
  if (flushInterval) {
    clearInterval(flushInterval);
    flushInterval = null;
  }
  if (hypixelCallBuffer.length > 0 || inflightBatch.length > 0) {
    await flushHypixelCallBuffer();
  }
}