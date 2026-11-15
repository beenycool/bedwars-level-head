import { sql, type SelectQueryBuilder } from 'kysely';
import { db } from './database/db';
import { ensureInitialized, isDatabaseReady } from './cache';
import type { Database, TrackedPlayerTable } from './database/schema';
import {
  chartGranularity,
  rangeSince,
  STATS_PAGE_SIZE,
  type StatsQuery,
  type StatsRange,
} from '../util/statsQuery';

export interface StatsSummary {
  lookups: number;
  cacheHits: number;
  errors: number;
  averageLatencyMs: number | null;
  playersInRange: number;
  trackedPlayers: number;
  cacheEntries: number;
  databaseSize: string;
}

export interface ChartPoint {
  bucket: Date;
  lookups: number;
}

export interface StatsPageData {
  summary: StatsSummary;
  chart: ChartPoint[];
  players: TrackedPlayerTable[];
  matchingPlayers: number;
  page: number;
  pageSize: number;
}

interface EventAggregateRow {
  players: string;
  cache_hits: string;
  errors: string;
  latency_sum: string;
}

interface CountRow {
  count: string;
}

interface ChartRow {
  bucket: Date;
  lookups: string;
}

function toNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Same filters for the page query and its `COUNT(*)` twin. */
function playersQuery(
  query: StatsQuery,
  since: Date | null,
): SelectQueryBuilder<Database, 'tracked_players', TrackedPlayerTable> {
  let builder = db.selectFrom('tracked_players') as SelectQueryBuilder<
    Database,
    'tracked_players',
    TrackedPlayerTable
  >;

  if (since) {
    builder = builder.where('last_looked_up_at', '>=', since);
  }

  if (query.search) {
    const pattern = `%${query.search.toLowerCase()}%`;
    builder = builder.where((eb) =>
      eb.or([eb('username', 'ilike', pattern), eb('identifier', 'like', pattern)]),
    );
  }

  return builder;
}

function orderPlayers(
  builder: SelectQueryBuilder<Database, 'tracked_players', TrackedPlayerTable>,
  sort: StatsQuery['sort'],
): SelectQueryBuilder<Database, 'tracked_players', TrackedPlayerTable> {
  switch (sort) {
    case 'lookups':
      return builder.orderBy('lookups', 'desc').orderBy('last_looked_up_at', 'desc');
    case 'stars':
      return builder.orderBy(sql`stars DESC NULLS LAST`).orderBy('last_looked_up_at', 'desc');
    default:
      return builder.orderBy('last_looked_up_at', 'desc');
  }
}

async function loadSummary(since: Date | null): Promise<StatsSummary> {
  const aggregate = await sql<EventAggregateRow>`
    SELECT
      COALESCE(SUM(players), 0) AS players,
      COALESCE(SUM(cache_hits), 0) AS cache_hits,
      COALESCE(SUM(errors), 0) AS errors,
      COALESCE(SUM(latency_sum_ms), 0) AS latency_sum
    FROM lookup_events
    ${since ? sql`WHERE looked_up_at >= ${since}` : sql``}
  `.execute(db);

  const totals = await sql<{ in_range: string; total: string }>`
    SELECT
      ${since ? sql`COUNT(*) FILTER (WHERE last_looked_up_at >= ${since})` : sql`COUNT(*)`} AS in_range,
      COUNT(*) AS total
    FROM tracked_players
  `.execute(db);

  const cacheRow = await sql<CountRow>`SELECT COUNT(*) AS count FROM player_stats_cache`.execute(db);
  const sizeRow = await sql<{ size: string }>`
    SELECT pg_size_pretty(pg_database_size(current_database())) AS size
  `.execute(db);

  const eventRow = aggregate.rows[0];
  const totalRow = totals.rows[0];
  const lookups = toNumber(eventRow?.players);
  const latencySum = toNumber(eventRow?.latency_sum);

  return {
    lookups,
    cacheHits: toNumber(eventRow?.cache_hits),
    errors: toNumber(eventRow?.errors),
    averageLatencyMs: lookups > 0 ? latencySum / lookups : null,
    playersInRange: toNumber(totalRow?.in_range),
    trackedPlayers: toNumber(totalRow?.total),
    cacheEntries: toNumber(cacheRow.rows[0]?.count),
    databaseSize: sizeRow.rows[0]?.size ?? '—',
  };
}

/**
 * Fills the gaps so the chart always has a fixed number of columns: 24 hours or
 * 7/30 days. Empty periods are meaningful (the proxy was idle) and must not squash
 * the bars that do exist.
 */
export function buildChartSeries(range: StatsRange, rows: ChartRow[], now: number = Date.now()): ChartPoint[] {
  const counts = new Map<number, number>();
  for (const row of rows) {
    const timestamp = new Date(row.bucket).getTime();
    if (Number.isFinite(timestamp)) {
      counts.set(timestamp, (counts.get(timestamp) ?? 0) + toNumber(row.lookups));
    }
  }

  if (range === 'all') {
    // No fixed window to fill: show the buckets that exist, newest last.
    return [...counts.entries()]
      .sort((a, b) => a[0] - b[0])
      .slice(-60)
      .map(([timestamp, lookups]) => ({ bucket: new Date(timestamp), lookups }));
  }

  const stepMs = range === '24h' ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
  const bucketCount = range === '24h' ? 24 : range === '7d' ? 7 : 30;
  const currentBucket = Math.floor(now / stepMs) * stepMs;

  // For hourly buckets the window includes the current hour, so start one step back.
  const points: ChartPoint[] = [];
  for (let index = bucketCount - 1; index >= 0; index -= 1) {
    const timestamp = currentBucket - index * stepMs;
    points.push({ bucket: new Date(timestamp), lookups: counts.get(timestamp) ?? 0 });
  }
  return points;
}

export async function loadStatsPage(query: StatsQuery): Promise<StatsPageData | null> {
  await ensureInitialized();
  if (!isDatabaseReady()) {
    return null;
  }

  const since = rangeSince(query.range);
  const granularity = chartGranularity(query.range);

  const [summary, chartRows, players, matchingRow] = await Promise.all([
    loadSummary(since),
    sql<ChartRow>`
      SELECT ${granularity === 'hour' ? sql`date_trunc('hour', looked_up_at)` : sql`date_trunc('day', looked_up_at)`} AS bucket,
             SUM(players) AS lookups
      FROM lookup_events
      ${since ? sql`WHERE looked_up_at >= ${since}` : sql``}
      GROUP BY 1
      ORDER BY 1
    `.execute(db),
    orderPlayers(playersQuery(query, since), query.sort)
      .selectAll()
      .limit(STATS_PAGE_SIZE)
      .offset((query.page - 1) * STATS_PAGE_SIZE)
      .execute(),
    playersQuery(query, since)
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .executeTakeFirst(),
  ]);

  return {
    summary,
    chart: buildChartSeries(query.range, chartRows.rows),
    players,
    matchingPlayers: toNumber(matchingRow?.count),
    page: query.page,
    pageSize: STATS_PAGE_SIZE,
  };
}

/** CSV export shares the table's filters but ignores pagination. */
export async function loadTrackedPlayersForExport(query: StatsQuery, limit = 50_000): Promise<TrackedPlayerTable[] | null> {
  await ensureInitialized();
  if (!isDatabaseReady()) {
    return null;
  }

  return orderPlayers(playersQuery(query, rangeSince(query.range)), query.sort)
    .selectAll()
    .limit(limit)
    .execute();
}
