import { pool, ensureInitialized } from './cache';
import { DatabaseType } from './database/adapter';
import { HYPIXEL_API_CALL_WINDOW_MS } from '../config';

const MAX_BUFFER_SIZE = 100;
const FLUSH_INTERVAL_MS = 5000;

interface BufferedCall {
  uuid: string;
  calledAt: number;
}

const hypixelCallBuffer: BufferedCall[] = [];
let inflightBatch: BufferedCall[] = [];
let isFlushing = false;
let flushInterval: NodeJS.Timeout | null = null;

async function flushHypixelCallBuffer(): Promise<void> {
  if (isFlushing || hypixelCallBuffer.length === 0) {
    return;
  }

  isFlushing = true;

  try {
    // Move buffer to inflight
    inflightBatch = [...hypixelCallBuffer];
    hypixelCallBuffer.length = 0;

    await ensureInitialized();

    const maxParams = pool.type === DatabaseType.POSTGRESQL ? 65000 : 2000;
    const maxRecordsPerChunk = Math.floor(maxParams / 2);

    for (let offset = 0; offset < inflightBatch.length; offset += maxRecordsPerChunk) {
      const chunk = inflightBatch.slice(offset, offset + maxRecordsPerChunk);
      const params = chunk.flatMap((r) => [r.calledAt, r.uuid]);
      const values = chunk.map((_, i) => `($${i * 2 + 1}, $${i * 2 + 2})`).join(', ');

      try {
        await pool.query(
          `INSERT INTO hypixel_api_calls (called_at, uuid) VALUES ${values}`,
          params,
        );
      } catch (error) {
        console.error('[hypixelTracker] Failed to flush batch', error);
      }
    }
  } finally {
    inflightBatch = [];
    isFlushing = false;
  }
}

export async function recordHypixelApiCall(uuid: string, calledAt: number = Date.now()): Promise<void> {
  hypixelCallBuffer.push({ uuid, calledAt });

  if (hypixelCallBuffer.length >= MAX_BUFFER_SIZE) {
    void flushHypixelCallBuffer().catch((error) => {
      console.error('[hypixelTracker] Flush failed', error);
    });
  }

  if (!flushInterval) {
    flushInterval = setInterval(() => {
      void flushHypixelCallBuffer().catch((error) => {
        console.error('[hypixelTracker] Flush interval failed', error);
      });
    }, FLUSH_INTERVAL_MS);
    flushInterval.unref();
  }
}

export async function getHypixelCallCount(
  windowMs: number = HYPIXEL_API_CALL_WINDOW_MS,
  now: number = Date.now(),
): Promise<number> {
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
  const inflightCount = inflightBatch.filter((item) => item.calledAt >= cutoff).length;

  const rawValue = result.rows[0]?.count ?? '0';
  const parsed = typeof rawValue === 'string' ? Number.parseInt(rawValue, 10) : Number(rawValue);
  const dbCount = Number.isFinite(parsed) ? parsed : 0;

  return dbCount + bufferCount + inflightCount;
}
