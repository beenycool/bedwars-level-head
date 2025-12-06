import { pool, ensureInitialized } from './cache';
import { HYPIXEL_API_CALL_WINDOW_MS } from '../config';

export async function recordHypixelApiCall(uuid: string, calledAt: number = Date.now()): Promise<void> {
  await ensureInitialized();
  await pool.query(
    `
    INSERT INTO hypixel_api_calls (called_at, uuid)
    VALUES ($1, $2)
    `,
    [calledAt, uuid],
  );
}

export async function getHypixelCallCount(
  windowMs: number = HYPIXEL_API_CALL_WINDOW_MS,
  now: number = Date.now(),
): Promise<number> {
  await ensureInitialized();
  const cutoff = now - windowMs;
  const result = await pool.query<{ count: string }>(
    `
    SELECT COUNT(*) AS count
    FROM hypixel_api_calls
    WHERE called_at >= $1
    `,
    [cutoff],
  );
  const rawValue = result.rows[0]?.count ?? '0';
  const parsed = Number.parseInt(rawValue, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}
