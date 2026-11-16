import { PUBLIC_RATE_LIMIT_WINDOW_MS, PUBLIC_REQUEST_LIMIT_MAX } from '../config';
import { publicRateLimiter } from '../middleware/rateLimit';
import { dynamicRateLimitSnapshot } from './dynamicRateLimit';

/**
 * A tiny in-process ring buffer for the "Process Memory Over Time" chart. The old
 * page kept a much larger resource sampler; this keeps the same chart without a
 * second store.
 */
export interface RuntimeSample {
  at: Date;
  rssMb: number;
  heapMb: number;
  cpuPercent: number;
}

export interface RuntimeSnapshot {
  rssMb: number;
  heapMb: number;
  heapTotalMb: number;
  cpuPercent: number;
  bufferSize: number;
  samples: RuntimeSample[];
  rateLimitKeys: number;
  rateLimitBudget: number;
  rateLimitWindowMs: number;
  rateLimitMode: 'dynamic' | 'fixed';
  rateLimitMin: number;
  rateLimitMax: number;
  rateLimitActiveClients: number;
  rateLimitNetworkCalls: number;
  rateLimitCacheHitRate: number | null;
  rateLimitHypixelRemaining: number;
  rateLimitRequestBudget: number;
}

const MAX_SAMPLES = 120;
const SAMPLE_INTERVAL_MS = 60_000;

const samples: RuntimeSample[] = [];
let lastCpu = process.cpuUsage();
let lastSampleAt = Date.now();
let cpuPercent = 0;

let initialized = false;

export function sampleRuntime(now: number = Date.now()): void {
  if (!initialized) {
    // Skip the startup burst: the first call only establishes a CPU baseline.
    initialized = true;
    lastCpu = process.cpuUsage();
    lastSampleAt = now;
    cpuPercent = 0;
    const memory = process.memoryUsage();
    samples.push({
      at: new Date(now),
      rssMb: memory.rss / 1024 / 1024,
      heapMb: memory.heapUsed / 1024 / 1024,
      cpuPercent: 0,
    });
    return;
  }

  const usage = process.cpuUsage(lastCpu);
  const elapsedMs = Math.max(1, now - lastSampleAt);
  cpuPercent = ((usage.user + usage.system) / 1000 / elapsedMs) * 100;
  lastCpu = process.cpuUsage();
  lastSampleAt = now;

  const memory = process.memoryUsage();
  samples.push({
    at: new Date(now),
    rssMb: memory.rss / 1024 / 1024,
    heapMb: memory.heapUsed / 1024 / 1024,
    cpuPercent,
  });
  while (samples.length > MAX_SAMPLES) {
    samples.shift();
  }
}

/** Samples at most once a minute, so page renders cannot flood the buffer. */
export function ensureRuntimeSample(now: number = Date.now()): void {
  if (now - lastSampleAt >= SAMPLE_INTERVAL_MS) {
    sampleRuntime(now);
  }
}

export function runtimeSnapshot(): RuntimeSnapshot {
  const memory = process.memoryUsage();
  const rateLimits = dynamicRateLimitSnapshot(publicRateLimiter.activeClients());
  return {
    rssMb: memory.rss / 1024 / 1024,
    heapMb: memory.heapUsed / 1024 / 1024,
    heapTotalMb: memory.heapTotal / 1024 / 1024,
    cpuPercent,
    bufferSize: samples.length,
    samples: [...samples],
    rateLimitKeys: publicRateLimiter.size,
    rateLimitBudget: rateLimits.limit,
    rateLimitWindowMs: PUBLIC_RATE_LIMIT_WINDOW_MS,
    rateLimitMode: rateLimits.enabled ? 'dynamic' : 'fixed',
    rateLimitMin: rateLimits.min,
    rateLimitMax: rateLimits.max,
    rateLimitActiveClients: rateLimits.activeClients,
    rateLimitNetworkCalls: rateLimits.networkCallsLastHour,
    rateLimitCacheHitRate: rateLimits.cacheHitRate,
    rateLimitHypixelRemaining: rateLimits.hypixelRemaining,
    rateLimitRequestBudget: PUBLIC_REQUEST_LIMIT_MAX,
  };
}
