import { purgeExpiredEntries, closeCache } from './services/cache';
import { flushHistoryBuffer, startHistoryFlushInterval, stopHistoryFlushInterval } from './services/history';
import {
  initializeDynamicRateLimitService,
  stopDynamicRateLimitService,
} from './services/dynamicRateLimit';
import { startAdaptiveTtlRefresh, stopAdaptiveTtlRefresh } from './services/statsCache';
import { startKeyCountRefresher, stopKeyCountRefresher } from './services/redis';
import {
  initializeResourceMetrics,
  stopResourceMetrics,
  flushResourceMetricsOnShutdown,
} from './services/resourceMetrics';
import { shutdown as shutdownHypixelTracker } from './services/hypixelTracker';

let purgeInterval: ReturnType<typeof setInterval> | null = null;
let cacheClosePromise: Promise<void> | null = null;

export function startBackgroundServices(): void {
  void purgeExpiredEntries().catch((error) => {
    console.error('Failed to purge expired cache entries', error);
  });

  void initializeDynamicRateLimitService().catch((error) => {
    console.error('Failed initializing dynamic rate limit service', error);
    process.exit(1);
  });

  void initializeResourceMetrics().catch((error) => {
    console.error('Failed initializing resource metrics', error);
    process.exit(1);
  });

  startHistoryFlushInterval();

  purgeInterval = setInterval(() => {
    void purgeExpiredEntries().catch((error) => {
      console.error('Failed to purge expired cache entries', error);
    });
  }, 60 * 60 * 1000);
}

export function startPostListenServices(): void {
  startAdaptiveTtlRefresh();
  startKeyCountRefresher();
}

export function stopAllServices(): void {
  if (purgeInterval) {
    clearInterval(purgeInterval);
    purgeInterval = null;
  }
  stopHistoryFlushInterval();
  stopDynamicRateLimitService();
  stopAdaptiveTtlRefresh();
  stopKeyCountRefresher();
  stopResourceMetrics();
}

export async function flushBeforeClose(): Promise<void> {
  await flushHistoryBuffer().catch((error) => {
    console.error('Error flushing history buffer during shutdown', error);
  });
  await shutdownHypixelTracker().catch((error) => {
    console.error('Error shutting down hypixel tracker during shutdown', error);
  });
  await flushResourceMetricsOnShutdown().catch((err) =>
    console.error('Failed to flush resource metrics on shutdown', err),
  );
}

export function safeCloseCache(): Promise<void> {
  if (!cacheClosePromise) {
    cacheClosePromise = closeCache().catch((error) => {
      console.error('Error closing cache database', error);
    });
  }
  return cacheClosePromise;
}
