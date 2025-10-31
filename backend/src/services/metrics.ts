import client from 'prom-client';

export const registry = new client.Registry();

client.collectDefaultMetrics({ register: registry });

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
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10],
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

const cacheHitRatioGauge = new client.Gauge({
  name: 'levelhead_cache_hit_ratio',
  help: 'Ratio of cache hits to total lookups.',
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

function updateCacheRatio(): void {
  const total = cacheHits + cacheMisses;
  if (total === 0) {
    cacheHitRatioGauge.set(0);
    return;
  }

  cacheHitRatioGauge.set(cacheHits / total);
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
