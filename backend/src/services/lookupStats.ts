import { sql, type RawBuilder } from 'kysely';
import { db } from './database/db';
import { ensureInitialized, isDatabaseReady } from './cache';
import type { LookupLogTable } from './database/schema';
import {
  chartGranularity,
  statsWindow,
  type ChartGranularity,
  type StatsQuery,
} from '../util/statsQuery';
import { ensureRuntimeSample, runtimeSnapshot, type RuntimeSnapshot } from './runtimeMetrics';
import { getMemoryCacheCapacity, getMemoryCacheSize } from './player';

export interface LatencyStats {
  p50: number | null;
  p95: number | null;
  p99: number | null;
  min: number | null;
  max: number | null;
  avg: number | null;
}

export interface StatsSummary {
  total: number;
  cacheHits: number;
  success: number;
  errors: number;
  players: number;
  nicked: number;
  apiCallsLastHour: number;
  latency: LatencyStats;
  cacheEntries: number;
  databaseSize: string;
  indexSize: string;
  cacheOnly: {
    hits: number;
    players: number;
  };
  memoryCacheEntries: number;
  memoryCacheCapacity: number;
}

export interface TimePoint {
  bucket: Date;
  total: number;
  cacheHits: number;
  avgLatency: number | null;
  p95Latency: number | null;
}

export interface Slice {
  label: string;
  count: number;
}

export interface TopPlayer {
  identifier: string;
  username: string | null;
  count: number;
}

export interface StatsCharts {
  series: TimePoint[];
  statuses: Slice[];
  stars: Slice[];
  latencyHistogram: Slice[];
  routes: Slice[];
  topPlayers: TopPlayer[];
}

export interface StatsPageData {
  summary: StatsSummary;
  charts: StatsCharts;
  rows: LookupLogTable[];
  matching: number;
  page: number;
  pageSize: number;
  runtime: RuntimeSnapshot;
}

interface Window {
  since: Date | null;
  until: Date | null;
}

interface SummaryRow {
  total: string;
  cache_hits: string;
  success: string;
  errors: string;
  players: string;
  nicked: string;
  api_calls: string;
  avg: string | null;
  min: number | null;
  max: number | null;
  metric_value: string | null;
}

interface CacheOnlyRow {
  hits: string;
  players: string;
}

interface InfraRow {
  cache_entries: string;
  db_size: string;
  index_size: string;
}

interface BucketRow {
  bucket: Date;
  total: string;
  hits: string;
  avg: string | null;
  p95: string | null;
}

interface SliceRow {
  label: string;
  count: string;
}

interface TopRow {
  identifier: string;
  username: string | null;
  count: string;
}

interface CountRow {
  count: string;
}

const STAR_ORDER = ['0-9', '10-49', '50-99', '100-199', '200-299', '300-499', '500-999', '1000+', 'No BW XP'];
const LATENCY_ORDER = ['0-50', '50-100', '100-250', '250-500', '500-1000', '1000+'];

const MAX_SERIES_BUCKETS = 2_000;
const PAGE_CACHE_TTL_MS = 5_000;
const PAGE_CACHE_LIMIT = 32;

const EXCLUDE_CACHE_ONLY = sql`route <> 'batch-cache'`;

const DASHED_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeSearch(search: string): string {
  return DASHED_UUID.test(search) ? search.replace(/-/g, '') : search;
}

function likePattern(search: string): string {
  return `%${search.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

function whereWindow(window: Window, extra: RawBuilder<unknown>[] = []) {
  const parts = [];
  if (window.since) {
    parts.push(sql`looked_up_at >= ${window.since}`);
  }
  if (window.until) {
    parts.push(sql`looked_up_at <= ${window.until}`);
  }
  parts.push(...extra);
  return parts.length > 0 ? sql`WHERE ${sql.join(parts, sql` AND `)}` : sql``;
}

function whereWindowAndSearch(window: Window, query: StatsQuery) {
  const parts = [];
  if (window.since) {
    parts.push(sql`looked_up_at >= ${window.since}`);
  }
  if (window.until) {
    parts.push(sql`looked_up_at <= ${window.until}`);
  }
  if (query.search) {
    const pattern = likePattern(normalizeSearch(query.search));
    parts.push(sql`(username ILIKE ${pattern} OR identifier ILIKE ${pattern})`);
  }
  if (query.status !== 'all') {
    const low = Number(query.status[0]) * 100;
    parts.push(sql`status >= ${low}`, sql`status < ${low + 100}`);
  }
  if (query.route !== 'all') {
    parts.push(sql`route = ${query.route}`);
  }
  if (query.source !== 'all') {
    parts.push(sql`source = ${query.source}`);
  }
  return parts.length > 0 ? sql`WHERE ${sql.join(parts, sql` AND `)}` : sql``;
}

function starScope(window: Window) {
  return whereWindow(window, [sql`status < 400`, sql`nicked = false`, EXCLUDE_CACHE_ONLY]);
}

function orderBy(sort: StatsQuery['sort']) {
  switch (sort) {
    case 'slowest':
      return sql`ORDER BY latency_ms DESC, looked_up_at DESC`;
    case 'stars':
      return sql`ORDER BY stars DESC NULLS LAST, looked_up_at DESC`;
    default:
      return sql`ORDER BY looked_up_at DESC`;
  }
}

function metricExpression(metric: StatsQuery['metric']) {
  switch (metric) {
    case 'p50':
      return sql`percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms)`;
    case 'p95':
      return sql`percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms)`;
    case 'p99':
      return sql`percentile_cont(0.99) WITHIN GROUP (ORDER BY latency_ms)`;
    case 'min':
      return sql`MIN(latency_ms)`;
    case 'max':
      return sql`MAX(latency_ms)`;
    default:
      return sql`AVG(latency_ms)`;
  }
}

function bucketExpression(unit: ChartGranularity, expression: RawBuilder<unknown>) {
  if (unit === '5 minute') {
    return sql`to_timestamp(floor(extract(epoch from ${expression}) / 300) * 300)`;
  }
  return sql`date_trunc(${unit}, ${expression})`;
}

function stepInterval(unit: ChartGranularity) {
  switch (unit) {
    case '5 minute':
      return sql`INTERVAL '5 minutes'`;
    case 'hour':
      return sql`INTERVAL '1 hour'`;
    default:
      return sql`INTERVAL '1 day'`;
  }
}

function fillSlices(slices: Slice[], order: string[]): Slice[] {
  const byLabel = new Map(slices.map((slice) => [slice.label, slice.count]));
  return order.map((label) => ({ label, count: byLabel.get(label) ?? 0 }));
}

function cacheKey(query: StatsQuery): string {
  return JSON.stringify([
    query.range,
    query.from?.getTime() ?? null,
    query.to?.getTime() ?? null,
    query.limit,
    query.metric,
    query.sort,
    query.search,
    query.status,
    query.route,
    query.source,
    query.page,
  ]);
}

interface CacheEntry {
  at: number;
  data: StatsPageData;
}

const pageCache = new Map<string, CacheEntry>();

function readCache(key: string, now: number): StatsPageData | null {
  const entry = pageCache.get(key);
  if (!entry) {
    return null;
  }
  if (now - entry.at >= PAGE_CACHE_TTL_MS) {
    pageCache.delete(key);
    return null;
  }
  return entry.data;
}

function writeCache(key: string, data: StatsPageData, now: number): void {
  if (pageCache.size >= PAGE_CACHE_LIMIT) {
    const oldest = pageCache.keys().next();
    if (!oldest.done) {
      pageCache.delete(oldest.value);
    }
  }
  pageCache.set(key, { at: now, data });
}

export async function loadStatsPage(query: StatsQuery): Promise<StatsPageData | null> {
  await ensureInitialized();
  if (!isDatabaseReady()) {
    return null;
  }

  const key = cacheKey(query);
  const now = Date.now();
  const cached = readCache(key, now);
  if (cached) {
    return cached;
  }

  ensureRuntimeSample();
  const window = statsWindow(query);
  const unit = chartGranularity(window.since, window.until);
  const step = stepInterval(unit);
  // Headline numbers describe real work; hub cache-only hits are cache hits with no
  // upstream cost and are reported separately instead of padding the hit rate.
  const scope = whereWindow(window, [EXCLUDE_CACHE_ONLY]);
  const windowScope = whereWindow(window);
  const pageScope = whereWindowAndSearch(window, query);
  const offset = (query.page - 1) * query.limit;

  const [
    summaryRows,
    cacheOnlyRows,
    infraRows,
    requestRows,
    statusRows,
    starRows,
    histogramRows,
    routeRows,
    topRows,
    rows,
    matchingRows,
  ] = await Promise.all([
    sql<SummaryRow>`
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE source = 'cache') AS cache_hits,
        COUNT(*) FILTER (WHERE status < 400) AS success,
        COUNT(*) FILTER (WHERE status >= 400) AS errors,
        COUNT(*) FILTER (WHERE nicked) AS nicked,
        COUNT(DISTINCT identifier) AS players,
        (SELECT COUNT(*) FROM lookup_log
          WHERE source = 'network' AND looked_up_at >= NOW() - INTERVAL '1 hour') AS api_calls,
        AVG(latency_ms) AS avg,
        MIN(latency_ms) AS min,
        MAX(latency_ms) AS max,
        ${metricExpression(query.metric)} AS metric_value
      FROM lookup_log
      ${scope}
    `.execute(db),
    sql<CacheOnlyRow>`
      SELECT COUNT(*) AS hits, COUNT(DISTINCT identifier) AS players
      FROM lookup_log
      ${whereWindow(window, [sql`route = 'batch-cache'`])}
    `.execute(db),
    sql<InfraRow>`
      SELECT
        (SELECT COUNT(*) FROM player_stats_cache) AS cache_entries,
        pg_size_pretty(pg_database_size(current_database())) AS db_size,
        (SELECT pg_size_pretty(COALESCE(SUM(pg_relation_size(indexrelid)), 0))
           FROM pg_stat_user_indexes) AS index_size
    `.execute(db),
    sql<BucketRow>`
      WITH raw_bounds AS (
        SELECT
          ${bucketExpression(unit, sql`COALESCE(${window.since}::timestamptz, (SELECT MIN(looked_up_at) FROM lookup_log), NOW())`)} AS start,
          ${bucketExpression(unit, sql`COALESCE(${window.until}::timestamptz, NOW())`)} AS finish
      ),
      bounds AS (
        SELECT GREATEST(start, finish - (${MAX_SERIES_BUCKETS - 1} * ${step})) AS start, finish
        FROM raw_bounds
      ),
      buckets AS (
        SELECT generate_series(start, finish, ${step}) AS bucket
        FROM bounds
      ),
      filtered AS (
        SELECT ${bucketExpression(unit, sql`looked_up_at`)} AS bucket, source, latency_ms
        FROM lookup_log
        ${scope}
      )
      SELECT b.bucket AS bucket,
             COUNT(f.bucket)::text AS total,
             COUNT(f.bucket) FILTER (WHERE f.source = 'cache')::text AS hits,
             AVG(f.latency_ms)::text AS avg,
             percentile_cont(0.95) WITHIN GROUP (ORDER BY f.latency_ms)::text AS p95
      FROM buckets b
      LEFT JOIN filtered f ON f.bucket = b.bucket
      GROUP BY b.bucket
      ORDER BY b.bucket
    `.execute(db),
    sql<SliceRow>`
      SELECT status::text AS label, COUNT(*) AS count
      FROM lookup_log
      ${scope}
      GROUP BY status
      ORDER BY count DESC
      LIMIT 8
    `.execute(db),
    sql<SliceRow>`
      SELECT CASE
               WHEN stars IS NULL THEN 'No BW XP'
               WHEN stars < 10 THEN '0-9'
               WHEN stars < 50 THEN '10-49'
               WHEN stars < 100 THEN '50-99'
               WHEN stars < 200 THEN '100-199'
               WHEN stars < 300 THEN '200-299'
               WHEN stars < 500 THEN '300-499'
               WHEN stars < 1000 THEN '500-999'
               ELSE '1000+'
             END AS label,
             COUNT(*) AS count
      FROM (
        SELECT DISTINCT ON (identifier) identifier, stars
        FROM lookup_log
        ${starScope(window)}
        ORDER BY identifier, looked_up_at DESC
      ) latest
      GROUP BY 1
    `.execute(db),
    sql<SliceRow>`
      SELECT CASE
               WHEN latency_ms < 50 THEN '0-50'
               WHEN latency_ms < 100 THEN '50-100'
               WHEN latency_ms < 250 THEN '100-250'
               WHEN latency_ms < 500 THEN '250-500'
               WHEN latency_ms < 1000 THEN '500-1000'
               ELSE '1000+'
             END AS label,
             COUNT(*) AS count
      FROM lookup_log
      ${scope}
      GROUP BY 1
    `.execute(db),
    sql<SliceRow>`
      SELECT route AS label, COUNT(*) AS count
      FROM lookup_log
      ${windowScope}
      GROUP BY route
      ORDER BY count DESC
    `.execute(db),
    sql<TopRow>`
      SELECT identifier, MAX(username) AS username, COUNT(*) AS count
      FROM lookup_log
      ${scope}
      GROUP BY identifier
      ORDER BY count DESC
      LIMIT 10
    `.execute(db),
    sql<LookupLogTable>`
      SELECT id, looked_up_at, identifier, username, stars, nicked, source, route, status, latency_ms
      FROM lookup_log
      ${pageScope}
      ${orderBy(query.sort)}
      LIMIT ${query.limit}
      OFFSET ${offset}
    `.execute(db),
    sql<CountRow>`
      SELECT COUNT(*) AS count FROM lookup_log ${pageScope}
    `.execute(db),
  ]);

  const summaryRow = summaryRows.rows[0];
  const cacheOnlyRow = cacheOnlyRows.rows[0];
  const infra = infraRows.rows[0];

  const series: TimePoint[] = requestRows.rows.map((row) => {
    const total = toNumber(row.total);
    return {
      bucket: new Date(row.bucket),
      total,
      cacheHits: toNumber(row.hits),
      avgLatency: total > 0 ? toNullableNumber(row.avg) : null,
      p95Latency: total > 0 ? toNullableNumber(row.p95) : null,
    };
  });

  const metricValue = toNullableNumber(summaryRow?.metric_value);
  const latency: LatencyStats = {
    p50: query.metric === 'p50' ? metricValue : null,
    p95: query.metric === 'p95' ? metricValue : null,
    p99: query.metric === 'p99' ? metricValue : null,
    min: toNullableNumber(summaryRow?.min),
    max: toNullableNumber(summaryRow?.max),
    avg: toNullableNumber(summaryRow?.avg),
  };

  const data: StatsPageData = {
    summary: {
      total: toNumber(summaryRow?.total),
      cacheHits: toNumber(summaryRow?.cache_hits),
      success: toNumber(summaryRow?.success),
      errors: toNumber(summaryRow?.errors),
      players: toNumber(summaryRow?.players),
      nicked: toNumber(summaryRow?.nicked),
      apiCallsLastHour: toNumber(summaryRow?.api_calls),
      latency,
      cacheEntries: toNumber(infra?.cache_entries),
      databaseSize: infra?.db_size ?? '—',
      indexSize: infra?.index_size ?? '—',
      cacheOnly: {
        hits: toNumber(cacheOnlyRow?.hits),
        players: toNumber(cacheOnlyRow?.players),
      },
      memoryCacheEntries: getMemoryCacheSize(),
      memoryCacheCapacity: getMemoryCacheCapacity(),
    },
    charts: {
      series,
      statuses: statusRows.rows.map((row) => ({ label: row.label, count: toNumber(row.count) })),
      stars: fillSlices(
        starRows.rows.map((row) => ({ label: row.label, count: toNumber(row.count) })),
        STAR_ORDER,
      ),
      latencyHistogram: fillSlices(
        histogramRows.rows.map((row) => ({ label: row.label, count: toNumber(row.count) })),
        LATENCY_ORDER,
      ),
      routes: routeRows.rows.map((row) => ({ label: row.label, count: toNumber(row.count) })),
      topPlayers: topRows.rows.map((row) => ({
        identifier: row.identifier,
        username: row.username,
        count: toNumber(row.count),
      })),
    },
    rows: rows.rows,
    matching: toNumber(matchingRows.rows[0]?.count),
    page: query.page,
    pageSize: query.limit,
    runtime: runtimeSnapshot(),
  };

  writeCache(key, data, now);
  return data;
}

export async function loadLookupRowsForExport(query: StatsQuery, limit = 50_000): Promise<LookupLogTable[] | null> {
  await ensureInitialized();
  if (!isDatabaseReady()) {
    return null;
  }

  const result = await sql<LookupLogTable>`
    SELECT id, looked_up_at, identifier, username, stars, nicked, source, route, status, latency_ms
    FROM lookup_log
    ${whereWindowAndSearch(statsWindow(query), query)}
    ${orderBy(query.sort)}
    LIMIT ${limit}
  `.execute(db);

  return result.rows;
}
