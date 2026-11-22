export const STATS_RANGES = ['24h', '7d', '30d', 'all'] as const;
export type StatsRange = (typeof STATS_RANGES)[number];

export const LATENCY_METRICS = ['p50', 'p95', 'p99', 'min', 'max', 'avg'] as const;
export type LatencyMetric = (typeof LATENCY_METRICS)[number];

export const STATS_SORTS = ['recent', 'slowest', 'stars'] as const;
export type StatsSort = (typeof STATS_SORTS)[number];

export const STATS_STATUS_FILTERS = ['all', '2xx', '4xx', '5xx'] as const;
export type StatsStatusFilter = (typeof STATS_STATUS_FILTERS)[number];

export const STATS_ROUTE_FILTERS = ['all', 'public', 'legacy', 'batch', 'batch-cache'] as const;
export type StatsRouteFilter = (typeof STATS_ROUTE_FILTERS)[number];

export const STATS_SOURCE_FILTERS = ['all', 'cache', 'network'] as const;
export type StatsSourceFilter = (typeof STATS_SOURCE_FILTERS)[number];

export const STATS_LIMITS = [25, 50, 100, 250] as const;
export const STATS_REFRESH = [0, 10, 30, 60, 300] as const;

export const STATS_MAX_SEARCH_LENGTH = 64;

export type ChartGranularity = '5 minute' | 'hour' | 'day';

export interface StatsQuery {
  range: StatsRange;
  from: Date | null;
  to: Date | null;
  limit: number;
  metric: LatencyMetric;
  sort: StatsSort;
  search: string;
  status: StatsStatusFilter;
  route: StatsRouteFilter;
  source: StatsSourceFilter;
  page: number;
  refresh: number;
}

const RANGE_LABELS: Record<StatsRange, string> = {
  '24h': 'Last 24 hours',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  all: 'All time',
};

const RANGE_DURATIONS_MS: Record<Exclude<StatsRange, 'all'>, number> = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
};

function firstValue(raw: unknown): string | undefined {
  if (typeof raw === 'string') {
    return raw;
  }
  if (Array.isArray(raw) && typeof raw[0] === 'string') {
    return raw[0];
  }
  return undefined;
}

function includes<T extends string>(values: readonly T[], value: string | undefined): value is T {
  return value !== undefined && (values as readonly string[]).includes(value);
}

const ZONE_LESS_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;

function parseDate(raw: unknown): Date | null {
  const value = firstValue(raw);
  if (!value) {
    return null;
  }
  const date = new Date(ZONE_LESS_DATETIME.test(value) ? `${value}Z` : value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function pickNumber<T extends number>(values: readonly T[], raw: string | undefined, fallback: T): T {
  const parsed = Number.parseInt(raw ?? '', 10);
  return (values as readonly number[]).includes(parsed) ? (parsed as T) : fallback;
}

export function parseStatsQuery(raw: Record<string, unknown>): StatsQuery {
  const range = firstValue(raw.range);
  const metric = firstValue(raw.metric);
  const sort = firstValue(raw.sort);
  const status = firstValue(raw.status);
  const route = firstValue(raw.route);
  const source = firstValue(raw.source);

  const rawSearch = firstValue(raw.q) ?? '';
  const search = rawSearch.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, STATS_MAX_SEARCH_LENGTH);

  const rawPage = Number.parseInt(firstValue(raw.page) ?? '', 10);
  const page = Number.isFinite(rawPage) && rawPage > 0 ? Math.min(rawPage, 10_000) : 1;

  return {
    range: includes(STATS_RANGES, range) ? range : '24h',
    from: parseDate(raw.from),
    to: parseDate(raw.to),
    limit: pickNumber(STATS_LIMITS, firstValue(raw.limit), 50),
    metric: includes(LATENCY_METRICS, metric) ? metric : 'p95',
    sort: includes(STATS_SORTS, sort) ? sort : 'recent',
    search,
    status: includes(STATS_STATUS_FILTERS, status) ? status : 'all',
    route: includes(STATS_ROUTE_FILTERS, route) ? route : 'all',
    source: includes(STATS_SOURCE_FILTERS, source) ? source : 'all',
    page,
    refresh: pickNumber(STATS_REFRESH, firstValue(raw.refresh), 0),
  };
}

export function rangeLabel(range: StatsRange): string {
  return RANGE_LABELS[range];
}

export function statsWindow(query: StatsQuery, now: number = Date.now()): { since: Date | null; until: Date | null } {
  if (query.from || query.to) {
    return { since: query.from, until: query.to };
  }
  if (query.range === 'all') {
    return { since: null, until: null };
  }
  return { since: new Date(now - RANGE_DURATIONS_MS[query.range]), until: null };
}

export function chartGranularity(
  since: Date | null,
  until: Date | null,
  now: number = Date.now(),
): ChartGranularity {
  if (!since) {
    return 'day';
  }
  const spanMs = (until?.getTime() ?? now) - since.getTime();
  if (spanMs <= 6 * 60 * 60 * 1000) {
    return '5 minute';
  }
  return spanMs <= 3 * 24 * 60 * 60 * 1000 ? 'hour' : 'day';
}
