import { purgeExpiredEntries, closeCache } from './services/cache';
import { logger } from './util/logger';
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
import { startGlobalLeaderElection, stopGlobalLeaderElection } from './services/globalLeader';

let globalPurgeInterval: ReturnType<typeof setInterval> | null = null;
let cacheClosePromise: Promise<void> | null = null;

async function startLeaderScopedServices(): Promise<void> {
  if (globalPurgeInterval) {
    return;
  }

  await purgeExpiredEntries().catch((error) => {
    logger.error('Failed to purge expired cache entries', error);
  });

  await initializeDynamicRateLimitService().catch((error) => {
    logger.error('Failed initializing dynamic rate limit service', error);
    throw error; // Let the caller (transitionToLeader) handle the failure
  });

  startKeyCountRefresher();

  globalPurgeInterval = setInterval(() => {
    void purgeExpiredEntries().catch((error) => {
      logger.error('Failed to purge expired cache entries', error);
    });
  }, 60 * 60 * 1000);
  globalPurgeInterval.unref();
}

async function stopLeaderScopedServices(): Promise<void> {
  if (globalPurgeInterval) {
    clearInterval(globalPurgeInterval);
    globalPurgeInterval = null;
  }

  stopDynamicRateLimitService();
  stopKeyCountRefresher();
}

export function startBackgroundServices(): void {
  void initializeResourceMetrics().catch((error) => {
    logger.error('Failed initializing resource metrics', error);
    process.exit(1);
  });

  startHistoryFlushInterval();

  startGlobalLeaderElection({
    onLeaderStart: startLeaderScopedServices,
    onLeaderStop: stopLeaderScopedServices,
  });
}

export function startPostListenServices(): void {
  startAdaptiveTtlRefresh();
}

export async function stopAllServices(): Promise<void> {
  await stopGlobalLeaderElection();
  stopHistoryFlushInterval();
  stopAdaptiveTtlRefresh();
  stopResourceMetrics();
}

export async function flushBeforeClose(): Promise<void> {
  await flushHistoryBuffer().catch((error) => {
    logger.error('Error flushing history buffer during shutdown', error);
  });
  await shutdownHypixelTracker().catch((error) => {
    logger.error('Error shutting down hypixel tracker during shutdown', error);
  });
  await flushResourceMetricsOnShutdown().catch((err) =>
    logger.error('Failed to flush resource metrics on shutdown', err),
  );
}

export function safeCloseCache(): Promise<void> {
  if (!cacheClosePromise) {
    cacheClosePromise = closeCache().catch((error) => {
      logger.error('Error closing cache database', error);
    });
  }
  return cacheClosePromise;
}
