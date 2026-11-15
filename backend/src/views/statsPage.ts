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

const PRESET_LABELS: Record<StatsRange, string> = {
  '24h': 'Last 24h',
  '7d': 'Last 7 Days',
  '30d': 'Last 30 Days',
  all: 'All Time',
};

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

function exportHref(query: StatsQuery): string {
  const params = new URLSearchParams();
  if (query.range !== '24h') params.set('range', query.range);
  if (query.sort !== 'recent') params.set('sort', query.sort);
  if (query.search) params.set('q', query.search);
  const queryString = params.toString();
  return queryString ? `/stats/export.csv?${queryString}` : '/stats/export.csv';
}

function renderFilterBar(query: StatsQuery, data: StatsPageData): string {
  const presets = STATS_RANGES.map((range) => {
    const current = range === query.range ? ' aria-current="page"' : '';
    return `<a class="preset-btn" href="${statsHref(query, { range, page: 1 })}"${current}>${PRESET_LABELS[range]}</a>`;
  }).join('');

  return `<div class="filter-controls">
    <div class="filter-form">
      <div class="filter-presets">${presets}</div>
      <a class="apply-btn" href="${escapeHtml(exportHref(query))}">Download CSV</a>
    </div>
    <p class="meta filter-summary">${escapeHtml(rangeLabel(query.range))} · ${formatNumber(data.summary.playersInRange)} players${query.search ? ` · filtered by “${escapeHtml(query.search)}”` : ''}</p>
  </div>`;
}

function renderStatCards(query: StatsQuery, data: StatsPageData): string {
  const { summary } = data;
  const cacheRate = summary.lookups > 0 ? (summary.cacheHits / summary.lookups) * 100 : 0;
  const successRate = summary.lookups > 0 ? ((summary.lookups - summary.errors) / summary.lookups) * 100 : 0;

  return `<div class="stat-grid">
    <div class="card stat-card">
      <p class="stat-label">Total Lookups</p>
      <p class="stat-value">${formatNumber(summary.lookups)}</p>
      <p class="stat-sub">${formatNumber(summary.playersInRange)} players · ${escapeHtml(rangeLabel(query.range).toLowerCase())}</p>
    </div>
    <div class="card stat-card">
      <p class="stat-label">Cache Hit Rate</p>
      <p class="stat-value">${cacheRate.toFixed(1)}%</p>
      <div class="progress" role="progressbar" aria-label="Cache Hit Rate" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(cacheRate)}"><span style="width:${Math.max(0, Math.min(100, cacheRate)).toFixed(1)}%"></span></div>
      <p class="stat-sub">${formatNumber(summary.cacheHits)} served from cache</p>
    </div>
    <div class="card stat-card">
      <p class="stat-label">Success Rate</p>
      <p class="stat-value">${successRate.toFixed(1)}%</p>
      <div class="progress" role="progressbar" aria-label="Success Rate" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(successRate)}"><span style="width:${Math.max(0, Math.min(100, successRate)).toFixed(1)}%"></span></div>
      <p class="stat-sub">${formatNumber(summary.errors)} failed lookups</p>
    </div>
    <div class="card stat-card">
      <p class="stat-label">Latency (avg)</p>
      <p class="stat-value">${escapeHtml(formatLatency(summary.averageLatencyMs))}</p>
      <p class="stat-sub">Across ${formatNumber(summary.lookups)} lookups</p>
    </div>
  </div>`;
}

/** Area chart, drawn server-side so the page needs no chart library. */
function volumeChart(points: ChartPoint[], range: StatsRange): string {
  const width = 640;
  const height = 180;
  const padding = 6;
  const peak = Math.max(1, ...points.map((point) => point.lookups));
  const step = points.length > 1 ? (width - padding * 2) / (points.length - 1) : 0;

  const coordinates = points.map((point, index) => ({
    x: padding + index * step,
    y: height - padding - (point.lookups / peak) * (height - padding * 2),
  }));

  const line = coordinates
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x.toFixed(1)},${point.y.toFixed(1)}`)
    .join(' ');
  const area = `${line} L${(width - padding).toFixed(1)},${height - padding} L${padding},${height - padding} Z`;

  const grid = [0.25, 0.5, 0.75]
    .map(
      (fraction) =>
        `<line x1="0" y1="${(height * fraction).toFixed(0)}" x2="${width}" y2="${(height * fraction).toFixed(0)}" stroke="rgba(148,163,184,0.12)" stroke-width="1" />`,
    )
    .join('');

  const total = points.reduce((sum, point) => sum + point.lookups, 0);
  const label = `${rangeLabel(range)}: ${formatNumber(total)} lookups, peak ${formatNumber(peak)} per bucket`;

  return `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="${escapeHtml(label)}">
    <defs>
      <linearGradient id="volume-fill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#22d3ee" stop-opacity="0.35" />
        <stop offset="100%" stop-color="#3b82f6" stop-opacity="0.02" />
      </linearGradient>
    </defs>
    ${grid}
    <path d="${area}" fill="url(#volume-fill)" />
    <path d="${line}" fill="none" stroke="#38bdf8" stroke-width="2" vector-effect="non-scaling-stroke" />
  </svg>`;
}

function statusDonut(data: StatsPageData): string {
  const { lookups, errors } = data.summary;
  const success = Math.max(0, lookups - errors);
  const ratio = lookups > 0 ? success / lookups : 0;
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const dash = circumference * ratio;
  const value = lookups > 0 ? `${(ratio * 100).toFixed(1)}%` : '--';

  const ring =
    lookups > 0
      ? `<circle cx="80" cy="80" r="${radius}" fill="none" stroke="#f87171" stroke-width="14" opacity="0.85" />
         <circle cx="80" cy="80" r="${radius}" fill="none" stroke="#4ade80" stroke-width="14" stroke-dasharray="${dash.toFixed(2)} ${(circumference - dash).toFixed(2)}" transform="rotate(-90 80 80)" />`
      : `<circle cx="80" cy="80" r="${radius}" fill="none" stroke="#334155" stroke-width="14" />`;

  return `<div class="donut">
    <svg viewBox="0 0 160 160" role="img" aria-label="HTTP status breakdown: ${escapeHtml(value)} success">
      ${ring}
      <text x="80" y="82" text-anchor="middle" fill="#e2e8f0" font-size="22" font-weight="700">${escapeHtml(value)}</text>
      <text x="80" y="99" text-anchor="middle" fill="#94a3b8" font-size="10">success</text>
    </svg>
    <ul class="legend">
      <li><span class="dot" style="background:#4ade80"></span>Success · ${formatNumber(success)} (${formatPercent(success, lookups)})</li>
      <li><span class="dot" style="background:#f87171"></span>Errors · ${formatNumber(errors)} (${formatPercent(errors, lookups)})</li>
    </ul>
  </div>`;
}

function renderCharts(query: StatsQuery, data: StatsPageData): string {
  const first = data.chart[0];
  const last = data.chart[data.chart.length - 1];
  const total = data.chart.reduce((sum, point) => sum + point.lookups, 0);
  const bucket = query.range === '24h' ? 'Hourly' : 'Daily';

  const axisLabel = (point: ChartPoint): string => {
    if (query.range === '24h') {
      return `${String(point.bucket.getUTCHours()).padStart(2, '0')}:00`;
    }
    return point.bucket.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  };

  return `<div class="dashboard-grid">
    <div class="card">
      <div class="card-header"><h2>Requests Over Time</h2><span class="meta">${bucket} buckets</span></div>
      <div class="chart-shell">${volumeChart(data.chart, query.range)}</div>
      <div class="chart-axis">
        <span>${first ? escapeHtml(axisLabel(first)) : ''}</span>
        <span>${formatNumber(total)} lookups</span>
        <span>${last ? escapeHtml(axisLabel(last)) : ''}</span>
      </div>
    </div>
    <div class="card">
      <div class="card-header"><h2>Status Breakdown</h2></div>
      ${statusDonut(data)}
    </div>
  </div>`;
}

function statusBadge(status: number): string {
  const statusClass = `status-${Math.floor(status / 100)}xx`;
  return `<span class="status-badge ${statusClass}">${escapeHtml(status)}</span>`;
}

function renderRow(player: TrackedPlayerTable): string {
  const resolved = player.nicked ? '(nicked)' : player.username ?? 'unknown';
  const stars = player.stars === null ? '--' : formatNumber(player.stars);
  const source = player.last_source === 'cache' ? 'Cache' : 'Network';
  const profileUrl = `https://namemc.com/profile/${encodeURIComponent(player.identifier)}`;

  return `<tr>
    <td class="col-seen col-seen-cell" title="${escapeHtml(formatIsoMinute(player.last_looked_up_at))}">${escapeHtml(formatRelativeTime(player.last_looked_up_at))}</td>
    <td class="col-lookup"><a class="lookup-link" href="${profileUrl}" target="_blank" rel="noopener noreferrer">UUID: ${escapeHtml(shortenUuid(player.identifier))}</a></td>
    <td>${escapeHtml(resolved)}</td>
    <td class="stars">${escapeHtml(stars)}</td>
    <td class="col-source">${escapeHtml(source)}</td>
    <td>${statusBadge(player.last_status)}</td>
    <td class="col-latency latency">${escapeHtml(formatLatency(player.last_latency_ms))}</td>
  </tr>`;
}

function renderLookupTable(query: StatsQuery, data: StatsPageData): string {
  const totalPages = Math.max(1, Math.ceil(data.matchingPlayers / data.pageSize));
  const rows = data.players.map(renderRow).join('');

  const body = rows
    ? `<div class="table-wrap"><table>
        <thead>
          <tr>
            <th scope="col" class="col-seen">Last Seen</th>
            <th scope="col" class="col-lookup">Lookup</th>
            <th scope="col">Resolved</th>
            <th scope="col">Stars</th>
            <th scope="col" class="col-source">Source</th>
            <th scope="col">Status</th>
            <th scope="col" class="col-latency">Latency</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table></div>`
    : `<div class="empty-state">
        <strong>${query.search ? 'No players match this search' : 'No lookups recorded yet'}</strong>
        <span class="sub-text">${query.search ? `Nothing found for “${escapeHtml(query.search)}”.` : 'Lookups appear here as soon as the mod asks the proxy for a player.'}</span>
      </div>`;

  const previous =
    data.page <= 1
      ? `<span class="preset-btn" aria-disabled="true">← Previous</span>`
      : `<a class="preset-btn" href="${statsHref(query, { page: data.page - 1 })}">← Previous</a>`;
  const next =
    data.page >= totalPages
      ? `<span class="preset-btn" aria-disabled="true">Next →</span>`
      : `<a class="preset-btn" href="${statsHref(query, { page: data.page + 1 })}">Next →</a>`;

  const clearHref = statsHref(query, { search: '', page: 1 });

  return `<h2>Recent Player Lookups</h2>
  <p class="meta">${formatNumber(data.matchingPlayers)} players · page ${formatNumber(data.page)} of ${formatNumber(totalPages)} · one row per player</p>
  <div class="controls">
    <form class="search-box" method="get" action="/stats">
      <input type="hidden" name="range" value="${escapeHtml(query.range)}">
      <input type="search" name="q" value="${escapeHtml(query.search)}" placeholder="Search by username or UUID" aria-label="Search players">
      <select name="sort" aria-label="Sort players">
        <option value="recent"${query.sort === 'recent' ? ' selected' : ''}>Recent first</option>
        <option value="lookups"${query.sort === 'lookups' ? ' selected' : ''}>Most looked up</option>
        <option value="stars"${query.sort === 'stars' ? ' selected' : ''}>Highest stars</option>
      </select>
      <button type="submit">Search</button>
      ${query.search ? `<a class="preset-btn" href="${clearHref}">Clear</a>` : ''}
    </form>
    <div class="pager">${previous} ${next}</div>
  </div>
  ${body}`;
}

export function renderStatsPage({ query, data, retentionDays }: StatsPageProps): string {
  const rssMb = Math.round(process.memoryUsage().rss / 1024 / 1024);

  return renderLayout({
    title: 'Levelhead Player Stats',
    heading: 'Levelhead Analytics',
    subtitle: 'Live snapshot of BedWars lookups (rendered locally, no external dashboards).',
    body: `${renderFilterBar(query, data)}
${renderStatCards(query, data)}
${renderCharts(query, data)}
${renderLookupTable(query, data)}
<p class="meta page-foot">${formatNumber(data.summary.cacheEntries)} cached profiles · database ${escapeHtml(data.summary.databaseSize)} · ${formatNumber(rssMb)} MB RSS · events pruned after ${formatNumber(retentionDays)} days</p>`,
  });
}

/** Shown when `CACHE_DB_URL` is unset or the database is unreachable. */
export function renderUnavailablePage(reason: string): string {
  return renderLayout({
    title: 'Levelhead Player Stats',
    heading: 'Levelhead Analytics',
    subtitle: 'Live snapshot of BedWars lookups (rendered locally, no external dashboards).',
    body: `<div class="card notice">
      <h2>Tracking database unavailable</h2>
      <p class="meta">${escapeHtml(reason)}</p>
      <p class="meta">Set <code>CACHE_DB_URL</code> to a PostgreSQL connection string and restart the proxy. Player lookups keep working without it — only this page and its counters need the database.</p>
    </div>`,
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
