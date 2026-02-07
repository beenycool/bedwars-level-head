import client from 'prom-client';
import { BACKEND_VERSION, BUILD_REVISION } from '../config';

export const registry = new client.Registry();

client.collectDefaultMetrics({ register: registry });

const buildInfo = new client.Gauge({
  name: 'levelhead_build_info',
  help: 'Levelhead backend build metadata.',
  labelNames: ['version', 'revision'],
  registers: [registry],
});

buildInfo.set(
  {
    version: BACKEND_VERSION || 'dev',
    revision: BUILD_REVISION || 'unknown',
  },
  1,
);

export const httpRequestsTotal = new client.Counter({
  name: 'levelhead_http_requests_total',
  help: 'Total HTTP requests received by the Levelhead backend.',
  labelNames: ['method', 'route', 'status'],
  registers: [registry],
});

export const httpRequestDurationSeconds = new client.Histogram({
  name: 'levelhead_http_request_duration_seconds',
  help: 'HTTP request duration in seconds.',
  labelNames: ['method', 'route'],
  buckets: [
    0.005, // 5ms   - very fast cache hits
    0.01,  // 10ms
    0.025, // 25ms
    0.05,  // 50ms
    0.1,   // 100ms - typical Redis hit
    0.25,  // 250ms
    0.5,   // 500ms - typical SQL hit
    1,     // 1s
    2.5,   // 2.5s  - typical upstream hit
    5,     // 5s
    10,    // 10s   - p99 worst case
    30,    // 30s   - timeout cases
  ],
  registers: [registry],
});

export const httpResponsesByStatusClassTotal = new client.Counter({
  name: 'levelhead_http_responses_by_status_class_total',
  help: 'HTTP responses grouped by status class.',
  labelNames: ['method', 'route', 'status_class'],
  registers: [registry],
});

export const cacheHitsTotal = new client.Counter({
  name: 'levelhead_cache_hits_total',
  help: 'Number of cache hits served.',
  registers: [registry],
});

export const cacheMissesTotal = new client.Counter({
  name: 'levelhead_cache_misses_total',
  help: 'Number of cache misses encountered.',
  registers: [registry],
});

export const cacheMissesByReasonTotal = new client.Counter({
  name: 'levelhead_cache_misses_by_reason_total',
  help: 'Number of cache misses grouped by reason.',
  labelNames: ['reason'],
  registers: [registry],
});

export const cacheTierHitsTotal = new client.Counter({
  name: 'levelhead_cache_tier_hits_total',
  help: 'Number of cache hits grouped by cache tier.',
  labelNames: ['tier'],
  registers: [registry],
});

export const cacheTierMissesTotal = new client.Counter({
  name: 'levelhead_cache_tier_misses_total',
  help: 'Number of cache misses grouped by cache tier.',
  labelNames: ['tier', 'reason'],
  registers: [registry],
});

export const cacheSourceTotal = new client.Counter({
  name: 'levelhead_cache_source_total',
  help: 'Number of requests served grouped by data source (redis, sql, upstream).',
  labelNames: ['source'],
  registers: [registry],
});

const cacheRefreshTotal = new client.Counter({
  name: 'levelhead_cache_refresh_total',
  help: 'Total number of background cache refresh attempts.',
  labelNames: ['result'],
  registers: [registry],
});

const cacheHitRatioGauge = new client.Gauge({
  name: 'levelhead_cache_hit_ratio',
  help: 'Ratio of cache hits to total lookups.',
  registers: [registry],
});

export const activeUsersGauge = new client.Gauge({
  name: 'levelhead_active_private_users',
  help: 'Number of distinct private rate limit clients active in the configured window.',
  registers: [registry],
});

export const hypixelApiCallsGauge = new client.Gauge({
  name: 'levelhead_hypixel_api_calls_window',
  help: 'Number of Hypixel API calls recorded within the 5-minute sliding window.',
  registers: [registry],
});

export const hypixelRemainingQuotaGauge = new client.Gauge({
  name: 'levelhead_hypixel_remaining_quota',
  help: 'Remaining Hypixel API quota for the current 5-minute window.',
  registers: [registry],
});

export const dynamicRateLimitGauge = new client.Gauge({
  name: 'levelhead_dynamic_rate_limit',
  help: 'Currently calculated per-IP dynamic rate limit value.',
  registers: [registry],
});

export const rateLimitBlocksTotal = new client.Counter({
  name: 'levelhead_rate_limit_blocks_total',
  help: 'Number of requests blocked by the proxy rate limiter.',
  labelNames: ['type'],
  registers: [registry],
});

let cacheHits = 0;
let cacheMisses = 0;

function computeCacheHitRatio(): number {
  const total = cacheHits + cacheMisses;
  return total === 0 ? 0 : cacheHits / total;
}

function updateCacheRatio(): void {
  cacheHitRatioGauge.set(computeCacheHitRatio());
}

export function getCacheHitRatio(): number {
  return computeCacheHitRatio();
}

export function recordCacheHit(): void {
  cacheHitsTotal.inc();
  cacheHits += 1;
  updateCacheRatio();
}

export function recordCacheMiss(reason: string = 'unknown'): void {
  cacheMissesTotal.inc();
  cacheMissesByReasonTotal.inc({ reason });
  cacheMisses += 1;
  updateCacheRatio();
}

export function recordCacheTierHit(tier: 'l1' | 'l2'): void {
  cacheTierHitsTotal.inc({ tier });
}

export function recordCacheTierMiss(tier: 'l1' | 'l2', reason: string = 'unknown'): void {
  cacheTierMissesTotal.inc({ tier, reason });
}

export function recordCacheSourceHit(source: 'redis' | 'sql' | 'upstream'): void {
  cacheSourceTotal.inc({ source });
}

export function observeRequest(
  method: string,
  route: string,
  status: number,
  durationSeconds: number,
): void {
  httpRequestsTotal.inc({ method, route, status: status.toString() });
  httpRequestDurationSeconds.observe({ method, route }, durationSeconds);
  const classIndex = Math.trunc(status / 100);
  const label = classIndex > 0 ? `${classIndex}xx` : 'other';
  httpResponsesByStatusClassTotal.inc({ method, route, status_class: label });
}

export function recordCacheRefresh(result: 'success' | 'fail'): void {
  cacheRefreshTotal.inc({ result });
}
