import { purgeExpiredEntries, closeCache } from './services/cache';
import { pruneLookupLogs } from './services/lookupTracking';
import { sampleRuntime } from './services/runtimeMetrics';
import { logger } from './util/logger';

const PURGE_INTERVAL_MS = 60 * 60 * 1000;

let purgeTimer: ReturnType<typeof setTimeout> | null = null;
let sampleTimer: ReturnType<typeof setInterval> | null = null;
let running = false;
let cacheClosePromise: Promise<void> | null = null;

async function runPurge(): Promise<void> {
  await purgeExpiredEntries().catch((error) => {
    logger.error({ err: error }, '[scheduler] purge failed');
  });
  await pruneLookupLogs().catch((error) => {
    logger.error({ err: error }, '[scheduler] lookup-log prune failed');
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
  sampleRuntime();
  sampleTimer = setInterval(() => sampleRuntime(), 60_000);
  sampleTimer.unref();
  void runPurge();
}

export async function stopBackgroundServices(): Promise<void> {
  running = false;
  if (purgeTimer) {
    clearTimeout(purgeTimer);
    purgeTimer = null;
  }
  if (sampleTimer) {
    clearInterval(sampleTimer);
    sampleTimer = null;
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
