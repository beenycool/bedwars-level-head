import type { NextFunction, Request, Response } from 'express';
import client, { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

collectDefaultMetrics({ register: client.register });

const httpRequestDurationHistogram = new Histogram({
  name: 'levelhead_http_request_duration_seconds',
  help: 'Duration of HTTP requests handled by the Levelhead backend in seconds.',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
});

const cacheHitsTotal = new Counter({
  name: 'levelhead_cache_hits_total',
  help: 'Total number of cache hits.',
  labelNames: ['cache'],
});

const cacheMissesTotal = new Counter({
  name: 'levelhead_cache_misses_total',
  help: 'Total number of cache misses.',
  labelNames: ['cache'],
});

const cacheHitRatioGauge = new Gauge({
  name: 'levelhead_cache_hit_ratio',
  help: 'Cache hit ratio derived from total hits and misses.',
  labelNames: ['cache'],
  async collect() {
    this.reset();
    const [hitMetrics, missMetrics] = await Promise.all([cacheHitsTotal.get(), cacheMissesTotal.get()]);

    const entries = new Map<string, { labels: Record<string, string>; hits: number; misses: number }>();

    for (const metric of hitMetrics.values ?? []) {
      const labels = normalizeLabels(metric.labels);
      const key = serializeLabels(labels);
      entries.set(key, {
        labels,
        hits: metric.value,
        misses: entries.get(key)?.misses ?? 0,
      });
    }

    for (const metric of missMetrics.values ?? []) {
      const labels = normalizeLabels(metric.labels);
      const key = serializeLabels(labels);
      const entry = entries.get(key);
      if (entry) {
        entry.misses = metric.value;
      } else {
        entries.set(key, {
          labels,
          hits: 0,
          misses: metric.value,
        });
      }
    }

    for (const entry of entries.values()) {
      const total = entry.hits + entry.misses;
      const ratio = total === 0 ? 0 : entry.hits / total;
      this.set(entry.labels, ratio);
    }
  },
});

function normalizeLabels(labels?: Record<string, string | number | undefined>): Record<string, string> {
  if (!labels) {
    return {};
  }

  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(labels)) {
    if (value === undefined) {
      continue;
    }

    normalized[key] = String(value);
  }

  return normalized;
}

function serializeLabels(labels: Record<string, string>): string {
  const entries = Object.entries(labels).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return JSON.stringify(entries);
}

function getRoutePath(routePath: unknown): string | null {
  if (!routePath) {
    return null;
  }

  if (typeof routePath === 'string') {
    return routePath;
  }

  if (Array.isArray(routePath)) {
    return routePath[0] ?? null;
  }

  return null;
}

function normalizeRouteTemplate(req: Request): string {
  const base = req.baseUrl ?? '';
  const path = req.route ? getRoutePath(req.route.path) : null;

  if (path) {
    return `${base}${path}` || 'unknown_route';
  }

  if (base) {
    return base;
  }

  return 'unknown_route';
}

export function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const endTimer = httpRequestDurationHistogram.startTimer();

  res.once('finish', () => {
    const route = normalizeRouteTemplate(req);
    endTimer({
      method: req.method,
      route,
      status: String(res.statusCode),
    });
  });

  next();
}

export async function metricsHandler(_req: Request, res: Response): Promise<void> {
  const registry: Registry = client.register;
  res.setHeader('Content-Type', registry.contentType);
  res.end(await registry.metrics());
}

export function recordCacheHit(cache: string): void {
  cacheHitsTotal.inc({ cache });
}

export function recordCacheMiss(cache: string): void {
  cacheMissesTotal.inc({ cache });
}

export const metricsRegistry = client.register;
