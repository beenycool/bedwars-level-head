import { purgeExpiredEntries, closeCache } from './services/cache';
import { logger } from './util/logger';

const PURGE_INTERVAL_MS = 60 * 60 * 1000;

let purgeTimer: ReturnType<typeof setTimeout> | null = null;
let running = false;
let cacheClosePromise: Promise<void> | null = null;

async function runPurge(): Promise<void> {
  await purgeExpiredEntries().catch((error) => {
    logger.error({ err: error }, '[scheduler] purge failed');
  });

  if (running) {
    purgeTimer = setTimeout(() => void runPurge(), PURGE_INTERVAL_MS);
    purgeTimer.unref();
  }
}

export function startBackgroundServices(): void {
  if (running) {
    return;
  }
  running = true;
  void runPurge();
}

export async function stopBackgroundServices(): Promise<void> {
  running = false;
  if (purgeTimer) {
    clearTimeout(purgeTimer);
    purgeTimer = null;
  }
}

export function safeCloseCache(): Promise<void> {
  if (!cacheClosePromise) {
    cacheClosePromise = closeCache().catch((error) => {
      logger.error({ err: error }, '[scheduler] error closing the database');
    });
  }
  return cacheClosePromise;
}
