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
let flushPromise: Promise<void> | null = null;
let flushInterval: NodeJS.Timeout | null = null;

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
    // Bolt: Use pipeline to batch commands and reduce network round-trips
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

      // Process chunks from inflightBatch
      // We slice from the beginning and splice on success to avoid double counting
      while (inflightBatch.length > 0) {
        const chunk = inflightBatch.slice(0, maxRecordsPerChunk);
        // Bolt: Optimized from flatMap to reduce array allocations
        const params = new Array(chunk.length * 2);
        for (let i = 0; i < chunk.length; i++) {
          params[i * 2] = chunk[i].calledAt;
          params[i * 2 + 1] = chunk[i].uuid;
        }
        const values = chunk.map((_, i) => `($${i * 2 + 1}, $${i * 2 + 2})`).join(', ');

        try {
          await pool.query(
            `INSERT INTO hypixel_api_calls (called_at, uuid) VALUES ${values}`,
            params,
          );
          // Success: remove these items from inflightBatch immediately
          // This ensures getHypixelCallCount doesn't count them twice (once in DB, once here)
          inflightBatch.splice(0, chunk.length);
        } catch (error) {
          logger.error('[hypixelTracker] Failed to flush chunk, re-queueing remaining items', error);
          // Stop processing further chunks on error to preserve order/integrity
          break;
        }
      }
    } finally {
      // If items remain (due to error), put them back in the buffer to retry later
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

  // Backpressure: If buffer is full, wait for current flush
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
    flushInterval.unref();
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

  const result = await pool.query<{ count: string | number }>(
    `
    SELECT COUNT(*) AS count
    FROM hypixel_api_calls
    WHERE called_at >= $1
    `,
    [cutoff],
  );

  const bufferCount = hypixelCallBuffer.filter((item) => item.calledAt >= cutoff).length;
  // inflightBatch contains items currently being flushed but not yet confirmed written (or failed)
  const inflightCount = inflightBatch.filter((item) => item.calledAt >= cutoff).length;

  const rawValue = result.rows[0]?.count ?? '0';
  const parsed = typeof rawValue === 'string' ? Number.parseInt(rawValue, 10) : Number(rawValue);
  const dbCount = Number.isFinite(parsed) ? parsed : 0;

  return dbCount + bufferCount + inflightCount;
}

// Graceful shutdown
export async function shutdown(): Promise<void> {
  if (flushInterval) {
    clearInterval(flushInterval);
    flushInterval = null;
  }
  if (hypixelCallBuffer.length > 0 || inflightBatch.length > 0) {
      await flushHypixelCallBuffer();
  }
}
