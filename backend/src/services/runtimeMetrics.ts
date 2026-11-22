import {
  PUBLIC_BATCH_RATE_LIMIT_MIN,
  PUBLIC_RATE_LIMIT_WINDOW_MS,
  PUBLIC_REQUEST_LIMIT_MAX,
  PUBLIC_SINGLE_RATE_LIMIT_MIN,
} from '../config';
import { publicBatchRateLimiter, publicRateLimiter } from '../middleware/rateLimit';
import { dynamicRateLimitSnapshot } from './dynamicRateLimit';
import { getCircuitBreakerState, getUpstreamQuota, getUpstreamStatus } from './hypixel';

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
  rateLimitSingleBudget: number;
  rateLimitSingleMin: number;
  rateLimitSingleMax: number;
  rateLimitSingleActiveClients: number;
  rateLimitSingleKeys: number;
  rateLimitBatchBudget: number;
  rateLimitBatchMin: number;
  rateLimitBatchMax: number;
  rateLimitBatchActiveClients: number;
  rateLimitBatchKeys: number;
  rateLimitActiveClientUnion: number;
  upstreamState: 'closed' | 'open' | 'half-open';
  upstreamFailureCount: number;
  upstreamNextRetryAt: number | null;
  upstreamQuotaRemaining: number | null;
  upstreamQuotaResetAt: number | null;
  upstreamCooldownUntil: number | null;
  upstreamQueued: number;
  upstreamWindowLimit: number;
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

export function ensureRuntimeSample(now: number = Date.now()): void {
  if (now - lastSampleAt >= SAMPLE_INTERVAL_MS) {
    sampleRuntime(now);
  }
}

export function runtimeSnapshot(): RuntimeSnapshot {
  const memory = process.memoryUsage();
  const now = Date.now();
  const rateLimits = dynamicRateLimitSnapshot(
    'single',
    publicRateLimiter.activeClients(now),
    now,
    PUBLIC_SINGLE_RATE_LIMIT_MIN,
  );
  const batchLimits = dynamicRateLimitSnapshot(
    'batch',
    publicBatchRateLimiter.activeClients(now),
    now,
    PUBLIC_BATCH_RATE_LIMIT_MIN,
  );
  const breaker = getCircuitBreakerState();
  const quota = getUpstreamQuota();
  const upstream = getUpstreamStatus();
  const activeUnion = new Set([
    ...publicRateLimiter.activeClientIds(now),
    ...publicBatchRateLimiter.activeClientIds(now),
  ]).size;

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
    rateLimitSingleBudget: rateLimits.limit,
    rateLimitSingleMin: rateLimits.min,
    rateLimitSingleMax: rateLimits.max,
    rateLimitSingleActiveClients: rateLimits.activeClients,
    rateLimitSingleKeys: publicRateLimiter.size,
    rateLimitBatchBudget: batchLimits.limit,
    rateLimitBatchMin: batchLimits.min,
    rateLimitBatchMax: batchLimits.max,
    rateLimitBatchActiveClients: batchLimits.activeClients,
    rateLimitBatchKeys: publicBatchRateLimiter.size,
    rateLimitActiveClientUnion: activeUnion,
    upstreamState: breaker.state,
    upstreamFailureCount: breaker.failureCount,
    upstreamNextRetryAt: breaker.nextRetryAt,
    upstreamQuotaRemaining: quota ? quota.remaining : null,
    upstreamQuotaResetAt: quota ? quota.resetAt : null,
    upstreamCooldownUntil: upstream.cooldownUntil,
    upstreamQueued: upstream.queuedRequests,
    upstreamWindowLimit: upstream.windowLimit,
  };
}
