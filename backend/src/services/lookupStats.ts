import { sql } from 'kysely';
import { db } from './database/db';
import { ensureInitialized, isDatabaseReady } from './cache';
import type { LookupLogTable } from './database/schema';
import { chartGranularity, statsWindow, type StatsQuery } from '../util/statsQuery';
import { ensureRuntimeSample, runtimeSnapshot, type RuntimeSnapshot } from './runtimeMetrics';

export interface LatencyStats {
  p50: number;
  p95: number;
  p99: number;
  min: number;
  max: number;
  avg: number;
}

export interface StatsSummary {
  total: number;
  cacheHits: number;
  success: number;
  errors: number;
  players: number;
  apiCallsLastHour: number;
  latency: LatencyStats;
  cacheEntries: number;
  databaseSize: string;
  indexSize: string;
}

export interface TimePoint {
  bucket: Date;
  total: number;
  cacheHits: number;
  avgLatency: number;
  p95Latency: number;
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
  api_calls: string;
  avg: string | null;
  min: number | null;
  max: number | null;
  p50: string | null;
  p95: string | null;
  p99: string | null;
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

const STAR_ORDER = ['0-9', '10-49', '50-99', '100-199', '200-299', '300-499', '500-999', '1000+', 'Unknown'];
const LATENCY_ORDER = ['0-50', '50-100', '100-250', '250-500', '500-1000', '1000+'];

const MAX_SERIES_BUCKETS = 2_000;

function toNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function whereWindow(window: Window) {
  const parts = [];
  if (window.since) {
    parts.push(sql`looked_up_at >= ${window.since}`);
  }
  if (window.until) {
    parts.push(sql`looked_up_at <= ${window.until}`);
  }
  return parts.length > 0 ? sql`WHERE ${sql.join(parts, sql` AND `)}` : sql``;
}

function whereWindowAndSearch(window: Window, search: string) {
  const parts = [];
  if (window.since) {
    parts.push(sql`looked_up_at >= ${window.since}`);
  }
  if (window.until) {
    parts.push(sql`looked_up_at <= ${window.until}`);
  }
  if (search) {
    const pattern = `%${search.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
    parts.push(sql`(username ILIKE ${pattern} OR identifier ILIKE ${pattern})`);
  }
  return parts.length > 0 ? sql`WHERE ${sql.join(parts, sql` AND `)}` : sql``;
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

function fillSlices(slices: Slice[], order: string[]): Slice[] {
  const byLabel = new Map(slices.map((slice) => [slice.label, slice.count]));
  return order.map((label) => ({ label, count: byLabel.get(label) ?? 0 }));
}

export async function loadStatsPage(query: StatsQuery): Promise<StatsPageData | null> {
  await ensureInitialized();
  if (!isDatabaseReady()) {
    return null;
  }

  ensureRuntimeSample();
  const window = statsWindow(query);
  const unit = chartGranularity(window.since, window.until) === 'hour' ? 'hour' : 'day';
  const step = unit === 'hour' ? sql`INTERVAL '1 hour'` : sql`INTERVAL '1 day'`;
  const scope = whereWindow(window);
  const pageScope = whereWindowAndSearch(window, query.search);
  const offset = (query.page - 1) * query.limit;

  const [
    summaryRows,
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
        COUNT(DISTINCT identifier) AS players,
        (SELECT COUNT(*) FROM lookup_log
          WHERE source = 'network' AND looked_up_at >= NOW() - INTERVAL '1 hour') AS api_calls,
        AVG(latency_ms) AS avg,
        MIN(latency_ms) AS min,
        MAX(latency_ms) AS max,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms) AS p50,
        percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms) AS p95,
        percentile_cont(0.99) WITHIN GROUP (ORDER BY latency_ms) AS p99
      FROM lookup_log
      ${scope}
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
          date_trunc(${unit}, COALESCE(${window.since}::timestamptz, (SELECT MIN(looked_up_at) FROM lookup_log), NOW())) AS start,
          date_trunc(${unit}, COALESCE(${window.until}::timestamptz, NOW())) AS finish
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
        SELECT date_trunc(${unit}, looked_up_at) AS bucket, source, latency_ms
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
               WHEN stars IS NULL THEN 'Unknown'
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
      FROM lookup_log
      ${scope}
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
      ${scope}
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
  const infra = infraRows.rows[0];

  const series: TimePoint[] = requestRows.rows.map((row) => ({
    bucket: new Date(row.bucket),
    total: toNumber(row.total),
    cacheHits: toNumber(row.hits),
    avgLatency: toNumber(row.avg),
    p95Latency: toNumber(row.p95),
  }));

  return {
    summary: {
      total: toNumber(summaryRow?.total),
      cacheHits: toNumber(summaryRow?.cache_hits),
      success: toNumber(summaryRow?.success),
      errors: toNumber(summaryRow?.errors),
      players: toNumber(summaryRow?.players),
      apiCallsLastHour: toNumber(summaryRow?.api_calls),
      latency: {
        p50: toNumber(summaryRow?.p50),
        p95: toNumber(summaryRow?.p95),
        p99: toNumber(summaryRow?.p99),
        min: toNumber(summaryRow?.min),
        max: toNumber(summaryRow?.max),
        avg: toNumber(summaryRow?.avg),
      },
      cacheEntries: toNumber(infra?.cache_entries),
      databaseSize: infra?.db_size ?? '—',
      indexSize: infra?.index_size ?? '—',
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
}

export async function loadLookupRowsForExport(query: StatsQuery, limit = 50_000): Promise<LookupLogTable[] | null> {
  await ensureInitialized();
  if (!isDatabaseReady()) {
    return null;
  }

  const result = await sql<LookupLogTable>`
    SELECT id, looked_up_at, identifier, username, stars, nicked, source, route, status, latency_ms
    FROM lookup_log
    ${whereWindowAndSearch(statsWindow(query), query.search)}
    ${orderBy(query.sort)}
    LIMIT ${limit}
  `.execute(db);

  return result.rows;
}
