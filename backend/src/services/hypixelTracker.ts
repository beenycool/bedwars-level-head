import { pool, ensureInitialized } from './cache';
import { HYPIXEL_API_CALL_WINDOW_MS } from '../config';

const MAX_BUFFER_SIZE = 100;
const MAX_HARD_CAP = 10_000;
const FLUSH_INTERVAL_MS = 5000;
const MAX_RETRIES = 3;
const MAX_AGE_MS = 2 * HYPIXEL_API_CALL_WINDOW_MS;

interface BufferedCall { uuid: string; calledAt: number; retryCount: number; createdAt: number; }
const hypixelCallBuffer: BufferedCall[] = [];
const inflightBatch: BufferedCall[] = [];
let flushPromise: Promise<void> | null = null;
let flushInterval: NodeJS.Timeout | null = null;

async function flushHypixelCallBuffer(): Promise<void> {
  if (flushPromise) return flushPromise; if (hypixelCallBuffer.length === 0) return;
  flushPromise = (async () => {
    try {
      inflightBatch.push(...hypixelCallBuffer); hypixelCallBuffer.length = 0;
      await ensureInitialized();
      const maxParams = pool.getMaxParameters();
      const maxRecordsPerChunk = Math.floor(maxParams / 2);
      while (inflightBatch.length > 0) {
        const chunk = inflightBatch.slice(0, maxRecordsPerChunk);
        const params = chunk.flatMap((r) => [r.calledAt, r.uuid]);
        const values = chunk.map((_, i) => `(${pool.getPlaceholder(i * 2 + 1)}, ${pool.getPlaceholder(i * 2 + 2)})`).join(', ');
        try {
          await pool.query(`INSERT INTO hypixel_api_calls (called_at, uuid) VALUES ${values}`, params);
          inflightBatch.splice(0, chunk.length);
        } catch (error) {
          console.error('[hypixelTracker] flush chunk fail', error); break;
        }
      }
    } finally {
      if (inflightBatch.length > 0) {
        const now = Date.now();
        const eligible = inflightBatch.filter(item => {
           item.retryCount++; return item.retryCount <= MAX_RETRIES && (now - item.createdAt) <= MAX_AGE_MS;
        });
        if (eligible.length > 0) hypixelCallBuffer.unshift(...eligible);
        inflightBatch.length = 0;
      }
      flushPromise = null;
    }
  })();
  return flushPromise;
}

export async function recordHypixelApiCall(uuid: string, calledAt: number = Date.now()): Promise<void> {
  if (hypixelCallBuffer.length >= MAX_HARD_CAP) {
    if (flushPromise) await flushPromise; else await flushHypixelCallBuffer();
  }
  hypixelCallBuffer.push({ uuid, calledAt, retryCount: 0, createdAt: Date.now() });
  if (hypixelCallBuffer.length >= MAX_BUFFER_SIZE) {
    void flushHypixelCallBuffer().catch(() => {});
  }
  if (!flushInterval) {
    flushInterval = setInterval(() => { void flushHypixelCallBuffer().catch(() => {}); }, FLUSH_INTERVAL_MS);
    flushInterval.unref();
  }
}

export async function getHypixelCallCount(windowMs: number = HYPIXEL_API_CALL_WINDOW_MS, now: number = Date.now()): Promise<number> {
  await ensureInitialized();
  const cutoff = now - windowMs;
  const res = await pool.query<{ count: string | number }>(`SELECT COUNT(*) AS count FROM hypixel_api_calls WHERE called_at >= ${pool.getPlaceholder(1)}`, [cutoff]);
  const bCount = hypixelCallBuffer.filter((item) => item.calledAt >= cutoff).length;
  const iCount = inflightBatch.filter((item) => item.calledAt >= cutoff).length;
  const raw = res.rows[0]?.count ?? '0';
  const dbCount = typeof raw === 'string' ? Number.parseInt(raw, 10) : Number(raw);
  return dbCount + bCount + iCount;
}

export async function shutdown(): Promise<void> {
  if (flushInterval) { clearInterval(flushInterval); flushInterval = null; }
  if (hypixelCallBuffer.length > 0 || inflightBatch.length > 0) await flushHypixelCallBuffer();
}
