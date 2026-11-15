import {
  csvCell,
  escapeHtml,
  formatIsoMinute,
  formatLatency,
  formatNumber,
  formatPercent,
  formatRelativeTime,
  shortenUuid,
} from '../util/html';
import {
  rangeLabel,
  STATS_RANGES,
  type StatsQuery,
  type StatsRange,
} from '../util/statsQuery';
import type { ChartPoint, StatsPageData } from '../services/lookupStats';
import type { TrackedPlayerTable } from '../services/database/schema';
import { renderLayout } from './layout';

export interface StatsPageProps {
  query: StatsQuery;
  data: StatsPageData;
  retentionDays: number;
}

/** Builds a `/stats` URL, omitting defaults so shared links stay short. */
export function statsHref(query: StatsQuery, overrides: Partial<StatsQuery> = {}): string {
  const merged: StatsQuery = { ...query, ...overrides };
  const params = new URLSearchParams();

  if (merged.range !== '24h') params.set('range', merged.range);
  if (merged.sort !== 'recent') params.set('sort', merged.sort);
  if (merged.search) params.set('q', merged.search);
  if (merged.page > 1) params.set('page', String(merged.page));

  const queryString = params.toString();
  return queryString ? `/stats?${queryString}` : '/stats';
}

function rangeTabs(query: StatsQuery): string {
  const tabs = STATS_RANGES.map((range: StatsRange) => {
    const current = range === query.range ? ' aria-current="page"' : '';
    const short = range === 'all' ? 'All' : range;
    return `<a href="${statsHref(query, { range, page: 1 })}"${current}><span class="tab-full">${rangeLabel(range)}</span><span class="tab-short">${short}</span></a>`;
  }).join('');

  return `<div class="tabs" role="tablist">${tabs}</div>`;
}

function renderTiles(data: StatsPageData, query: StatsQuery): string {
  const { summary } = data;
  const tiles = [
    {
      label: 'Lookups',
      value: formatNumber(summary.lookups),
      sub: rangeLabel(query.range).toLowerCase(),
    },
    {
      label: 'Players seen',
      value: formatNumber(summary.playersInRange),
      sub: `${formatNumber(summary.trackedPlayers)} tracked all time`,
    },
    {
      label: 'Cache hit rate',
      value: formatPercent(summary.cacheHits, summary.lookups),
      sub: `${formatNumber(summary.cacheHits)} served from cache`,
    },
    {
      label: 'Error rate',
      value: formatPercent(summary.errors, summary.lookups),
      sub: `${formatNumber(summary.errors)} failed lookups`,
    },
    {
      label: 'Avg latency',
      value: formatLatency(summary.averageLatencyMs),
      sub: 'per player',
    },
    {
      label: 'Profiles',
      value: formatNumber(summary.cacheEntries),
      sub: 'SQL rows ready to serve',
    },
  ];

  return `<section class="tiles">${tiles
    .map(
      (tile) => `<div class="tile">
      <div class="label">${escapeHtml(tile.label)}</div>
      <div class="value">${escapeHtml(tile.value)}</div>
      <div class="sub">${escapeHtml(tile.sub)}</div>
    </div>`,
    )
    .join('')}</section>`;
}

function chartLabel(point: ChartPoint, range: StatsRange): string {
  if (range === '24h') {
    return `${String(point.bucket.getUTCHours()).padStart(2, '0')}:00`;
  }
  return point.bucket.toISOString().slice(5, 10).replace('-', ' ');
}

function renderChart(points: ChartPoint[], query: StatsQuery): string {
  const total = points.reduce((sum, point) => sum + point.lookups, 0);
  const peak = Math.max(1, ...points.map((point) => point.lookups));

  const bars = points
    .map((point) => {
      // Zero still gets a hairline so idle periods remain visible.
      const height = point.lookups === 0 ? 2 : Math.max(4, Math.round((point.lookups / peak) * 100));
      const tooltip = `${formatIsoMinute(point.bucket)} · ${formatNumber(point.lookups)} lookups`;
      return `<div class="bar" style="height:${height}%" title="${escapeHtml(tooltip)}"></div>`;
    })
    .join('');

  const first = points[0];
  const last = points[points.length - 1];
  const axis = first && last
    ? `<div class="chart-axis"><span>${escapeHtml(chartLabel(first, query.range))}</span><span>${formatNumber(total)} lookups</span><span>${escapeHtml(chartLabel(last, query.range))}</span></div>`
    : '';

  const bucketWord = query.range === '24h' ? 'Hourly' : 'Daily';

  return `<section class="panel">
    <div class="panel-head">
      <h2>Lookup volume</h2>
      <span class="hint">${bucketWord} buckets, ${escapeHtml(rangeLabel(query.range).toLowerCase())}</span>
    </div>
    <div class="chart">${bars}</div>
    ${axis}
  </section>`;
}

function statusBadge(status: number): string {
  const variant = status >= 500 ? 'bad' : status >= 400 ? 'warn' : status >= 300 ? 'idle' : 'ok';
  return `<span class="badge ${variant}">${escapeHtml(status)}</span>`;
}

function renderRow(player: TrackedPlayerTable): string {
  const name = player.username ?? 'Unknown player';
  const nicked = player.nicked ? ' <span class="badge nicked">nicked</span>' : '';
  const stars = player.stars === null ? '—' : formatNumber(player.stars);

  return `<tr>
    <td>
      <span class="player">${escapeHtml(name)}${nicked}</span>
      <span class="uuid">${escapeHtml(shortenUuid(player.identifier))}</span>
    </td>
    <td class="num">${escapeHtml(stars)}</td>
    <td class="num">${formatNumber(player.lookups)}</td>
    <td class="num col-cache">${formatPercent(player.cache_hits, player.lookups)}</td>
    <td class="num col-latency">${escapeHtml(formatLatency(player.last_latency_ms))}</td>
    <td class="col-status">${statusBadge(player.last_status)}</td>
    <td class="muted col-seen">${escapeHtml(formatRelativeTime(player.last_looked_up_at))}</td>
  </tr>`;
}

function renderControls(query: StatsQuery): string {
  return `<div class="controls">
    ${rangeTabs(query)}
    <form method="get" action="/stats">
      <input type="hidden" name="range" value="${escapeHtml(query.range)}">
      <input type="search" name="q" value="${escapeHtml(query.search)}" placeholder="Username or UUID prefix" aria-label="Search players">
      <select name="sort" aria-label="Sort players">
        <option value="recent"${query.sort === 'recent' ? ' selected' : ''}>Recent first</option>
        <option value="lookups"${query.sort === 'lookups' ? ' selected' : ''}>Most looked up</option>
        <option value="stars"${query.sort === 'stars' ? ' selected' : ''}>Highest stars</option>
      </select>
      <button type="submit">Apply</button>
    </form>
  </div>`;
}

function renderTable(query: StatsQuery, data: StatsPageData): string {
  const rows = data.players.map(renderRow).join('');
  const totalPages = Math.max(1, Math.ceil(data.matchingPlayers / data.pageSize));
  const exportHref = `/stats/export.csv?${new URLSearchParams({
    ...(query.range !== '24h' ? { range: query.range } : {}),
    ...(query.sort !== 'recent' ? { sort: query.sort } : {}),
    ...(query.search ? { q: query.search } : {}),
  }).toString()}`;

  const body = rows
    ? `<div class="table-wrap"><table>
        <thead>
          <tr>
            <th scope="col">Player</th>
            <th scope="col" class="num">Stars</th>
            <th scope="col" class="num">Lookups</th>
            <th scope="col" class="num col-cache">Cache</th>
            <th scope="col" class="num col-latency">Latency</th>
            <th scope="col" class="col-status">Status</th>
            <th scope="col" class="col-seen">Seen</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table></div>`
    : `<div class="empty">
        <strong>No tracked players match this view</strong>
        Lookups appear here as soon as the mod asks the proxy for a player.
      </div>`;

  const pager = `<div class="pager">
    <span>${formatNumber(data.matchingPlayers)} player${data.matchingPlayers === 1 ? '' : 's'} · page ${formatNumber(data.page)} of ${formatNumber(totalPages)}</span>
    <span>
      <a class="${data.page <= 1 ? 'disabled' : ''}" href="${statsHref(query, { page: Math.max(1, data.page - 1) })}">← Previous</a>
      &nbsp;·&nbsp;
      <a class="${data.page >= totalPages ? 'disabled' : ''}" href="${statsHref(query, { page: data.page + 1 })}">Next →</a>
    </span>
  </div>`;

  return `<section class="panel">
    <div class="panel-head">
      <h2>Tracked players</h2>
      <a class="export" href="${escapeHtml(exportHref)}">Export CSV</a>
    </div>
    ${body}
    ${pager}
  </section>`;
}

export function renderStatsPage({ query, data, retentionDays }: StatsPageProps): string {
  return renderLayout({
    title: 'Tracking · BedWars Levelhead',
    subtitle: `${escapeHtml(rangeLabel(query.range))} · ${formatNumber(data.summary.trackedPlayers)} players seen since tracking began`,
    body: `${renderControls(query)}
${renderTiles(data, query)}
${renderChart(data.chart, query)}
${renderTable(query, data)}
<p class="note">Lookup events are pruned after ${formatNumber(retentionDays)} days. Player counters are kept.</p>`,
  });
}

/** Shown when `CACHE_DB_URL` is unset or the database is unreachable. */
export function renderUnavailablePage(reason: string): string {
  return renderLayout({
    title: 'Tracking unavailable · BedWars Levelhead',
    subtitle: 'The proxy is serving player data, but tracking is not recording.',
    body: `<section class="panel">
      <div class="panel-head"><h2>Tracking database unavailable</h2></div>
      <p class="muted">${escapeHtml(reason)}</p>
      <p class="muted">Set <code>CACHE_DB_URL</code> to a PostgreSQL connection string and restart the proxy. Player lookups keep working without it — only this page and its counters need the database.</p>
    </section>`,
  });
}

/** RFC 4180 rows for `/stats/export.csv`. */
export function renderPlayersCsv(players: TrackedPlayerTable[]): string {
  const header = [
    'identifier',
    'username',
    'stars',
    'nicked',
    'lookups',
    'cache_hits',
    'last_source',
    'last_status',
    'last_latency_ms',
    'first_seen_at',
    'last_looked_up_at',
  ];

  const rows = players.map((player) =>
    [
      player.identifier,
      player.username,
      player.stars,
      player.nicked,
      player.lookups,
      player.cache_hits,
      player.last_source,
      player.last_status,
      player.last_latency_ms,
      player.first_seen_at.toISOString(),
      player.last_looked_up_at.toISOString(),
    ]
      .map(csvCell)
      .join(','),
  );

  return [header.map(csvCell).join(','), ...rows].join('\n');
}
