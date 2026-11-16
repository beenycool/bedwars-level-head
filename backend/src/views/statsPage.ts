import {
  csvCell,
  escapeHtml,
  formatIsoMinute,
  formatLatency,
  formatNumber,
  formatRelativeTime,
  shortenUuid,
} from '../util/html';
import {
  LATENCY_METRICS,
  rangeLabel,
  STATS_LIMITS,
  STATS_RANGES,
  STATS_REFRESH,
  type StatsQuery,
} from '../util/statsQuery';
import { HYPIXEL_HOURLY_QUOTA } from '../config';
import type { Slice, StatsPageData, TimePoint, TopPlayer } from '../services/lookupStats';
import type { LookupLogTable } from '../services/database/schema';
import { renderLayout } from './layout';
import { barChart, barLabels, donut, lineChart } from './charts';

export interface StatsPageProps {
  query: StatsQuery;
  data: StatsPageData;
  retentionDays: number;
}

const PRESET_LABELS: Record<string, string> = {
  '24h': 'Last 24h',
  '7d': 'Last 7 Days',
  '30d': 'Last 30 Days',
  all: 'All Time',
};

const METRIC_LABELS: Record<string, string> = {
  p50: 'p50 (median)',
  p95: 'p95',
  p99: 'p99',
  min: 'Min',
  max: 'Max',
  avg: 'Average',
};

const REFRESH_LABELS: Record<number, string> = {
  0: 'Off',
  10: '10s',
  30: '30s',
  60: '1m',
  300: '5m',
};

function datetimeValue(date: Date): string {
  return date.toISOString().slice(0, 16);
}

function plural(count: number, singular: string, pluralForm: string): string {
  return `${formatNumber(count)} ${count === 1 ? singular : pluralForm}`;
}

/** Shared mapping from query state to URL parameters. */
function queryParams(query: StatsQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (query.range !== '24h') params.set('range', query.range);
  if (query.from) params.set('from', datetimeValue(query.from));
  if (query.to) params.set('to', datetimeValue(query.to));
  if (query.limit !== 50) params.set('limit', String(query.limit));
  if (query.metric !== 'p95') params.set('metric', query.metric);
  if (query.sort !== 'recent') params.set('sort', query.sort);
  if (query.search) params.set('q', query.search);
  if (query.page > 1) params.set('page', String(query.page));
  if (query.refresh) params.set('refresh', String(query.refresh));
  return params;
}

export function statsHref(query: StatsQuery, overrides: Partial<StatsQuery> = {}): string {
  const params = queryParams({ ...query, ...overrides });
  const value = params.toString();
  return value ? `/stats?${value}` : '/stats';
}

function hiddenQuery(query: StatsQuery, exclude: (keyof StatsQuery)[] = []): string {
  const params = queryParams(query);
  return [...params.entries()]
    .filter(([key]) => !exclude.includes(key as keyof StatsQuery))
    .map(([key, value]) => `<input type="hidden" name="${escapeHtml(key)}" value="${escapeHtml(value)}">`)
    .join('');
}

function renderFilters(query: StatsQuery, data: StatsPageData): string {
  const presets = STATS_RANGES.map((range) => {
    const current = range === query.range && !query.from && !query.to ? ' aria-current="page"' : '';
    return `<a class="preset-btn" href="${statsHref(query, { range, from: null, to: null, page: 1 })}"${current}>${PRESET_LABELS[range]}</a>`;
  }).join('');

  const limitOptions = STATS_LIMITS.map(
    (limit) => `<option value="${limit}"${limit === query.limit ? ' selected' : ''}>${limit}</option>`,
  ).join('');
  const refreshOptions = STATS_REFRESH.map(
    (seconds) => `<option value="${seconds}"${seconds === query.refresh ? ' selected' : ''}>${REFRESH_LABELS[seconds]}</option>`,
  ).join('');

  const windowText = query.from || query.to
    ? `${query.from ? escapeHtml(datetimeValue(query.from)) : 'start'} → ${query.to ? escapeHtml(datetimeValue(query.to)) : 'now'}`
    : rangeLabel(query.range);

  return `<div class="filter-controls">
    <form id="filterForm" method="get" action="/stats" class="filter-form">
      <input type="hidden" name="q" value="${escapeHtml(query.search)}">
      <input type="hidden" name="sort" value="${escapeHtml(query.sort)}">
      <input type="hidden" name="metric" value="${escapeHtml(query.metric)}">
      <div class="filter-group">
        <label for="fromDate">From (UTC)</label>
        <input type="datetime-local" id="fromDate" name="from" value="${query.from ? datetimeValue(query.from) : ''}">
      </div>
      <div class="filter-group">
        <label for="toDate">To (UTC)</label>
        <input type="datetime-local" id="toDate" name="to" value="${query.to ? datetimeValue(query.to) : ''}">
      </div>
      <div class="filter-group">
        <label for="limitInput">Limit</label>
        <select id="limitInput" name="limit">${limitOptions}</select>
      </div>
      <div class="filter-group">
        <label for="refreshInput">Auto-refresh</label>
        <select id="refreshInput" name="refresh">${refreshOptions}</select>
      </div>
      <div class="filter-presets">${presets}</div>
      <div class="filter-actions">
        <button type="submit" class="apply-btn">Apply Filters</button>
        <a class="preset-btn" href="${statsHref(query)}">Refresh Now</a>
        <a class="reset-btn" href="/stats">Reset</a>
      </div>
    </form>
    <p class="meta filter-summary">${windowText} · ${plural(data.summary.total, 'lookup', 'lookups')} · ${plural(data.summary.players, 'player', 'players')}</p>
  </div>`;
}

function renderMetricForm(query: StatsQuery): string {
  const options = LATENCY_METRICS.map(
    (metric) => `<option value="${metric}"${metric === query.metric ? ' selected' : ''}>${METRIC_LABELS[metric]}</option>`,
  ).join('');

  return `<form method="get" action="/stats" class="metric-form">
    ${hiddenQuery(query, ['metric'])}
    <select name="metric" aria-label="Latency metric">${options}</select>
    <button type="submit">Apply</button>
  </form>`;
}

function renderStats(query: StatsQuery, data: StatsPageData): string {
  const { summary } = data;
  const cacheRate = summary.total > 0 ? (summary.cacheHits / summary.total) * 100 : 0;
  const successRate = summary.total > 0 ? (summary.success / summary.total) * 100 : 0;
  const latency = summary.latency[query.metric];

  return `<div class="stat-grid">
    <div class="card stat-card">
      <p class="stat-label">Total Lookups</p>
      <p class="stat-value">${formatNumber(summary.total)}</p>
      <p class="stat-sub">${plural(summary.players, 'player', 'players')} · ${escapeHtml(rangeLabel(query.range).toLowerCase())}</p>
    </div>
    <div class="card stat-card">
      <p class="stat-label">Cache Hit Rate</p>
      <p class="stat-value">${cacheRate.toFixed(1)}%</p>
      <div class="progress" role="progressbar" aria-label="Cache Hit Rate" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(cacheRate)}"><span style="width:${cacheRate.toFixed(1)}%"></span></div>
      <p class="stat-sub">${formatNumber(summary.cacheHits)} served from cache</p>
    </div>
    <div class="card stat-card">
      <p class="stat-label">Success Rate</p>
      <p class="stat-value">${successRate.toFixed(1)}%</p>
      <div class="progress" role="progressbar" aria-label="Success Rate" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(successRate)}"><span style="width:${successRate.toFixed(1)}%"></span></div>
      <p class="stat-sub">${formatNumber(summary.errors)} failed lookups</p>
    </div>
    <div class="card stat-card">
      <p class="stat-label">Latency (${escapeHtml(query.metric)})</p>
      <p class="stat-value">${escapeHtml(formatLatency(latency))}</p>
      <p class="stat-sub">From ${plural(summary.total, 'sample', 'samples')}</p>
      ${renderMetricForm(query)}
    </div>
  </div>`;
}

function renderInfrastructure(data: StatsPageData): string {
  const { summary } = data;
  const quota = Math.min(100, (summary.apiCallsLastHour / HYPIXEL_HOURLY_QUOTA) * 100);

  return `<h2>Infrastructure Health</h2>
  <div class="stat-grid">
    <div class="card stat-card">
      <p class="stat-label">Database Size</p>
      <p class="stat-value">${escapeHtml(summary.databaseSize)}</p>
      <p class="stat-sub">Index: ${escapeHtml(summary.indexSize)}</p>
    </div>
    <div class="card stat-card">
      <p class="stat-label">Hypixel API (1h)</p>
      <p class="stat-value">${formatNumber(summary.apiCallsLastHour)}</p>
      <div class="progress" role="progressbar" aria-label="Hypixel API quota usage" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(quota)}"><span style="width:${quota.toFixed(1)}%"></span></div>
      <p class="stat-sub">Network lookups, last hour</p>
    </div>
    <div class="card stat-card">
      <p class="stat-label">Cached Profiles</p>
      <p class="stat-value">${formatNumber(summary.cacheEntries)}</p>
      <p class="stat-sub">Rows ready to serve</p>
    </div>
  </div>`;
}

function renderProcess(data: StatsPageData): string {
  const { runtime } = data;

  return `<h2>Process Resources</h2>
  <div class="stat-grid">
    <div class="card stat-card">
      <p class="stat-label">Memory (RSS)</p>
      <p class="stat-value">${runtime.rssMb.toFixed(1)} MB</p>
      <p class="stat-sub">Resident Set Size</p>
    </div>
    <div class="card stat-card">
      <p class="stat-label">Heap Used</p>
      <p class="stat-value">${runtime.heapMb.toFixed(1)} MB</p>
      <p class="stat-sub">Of ${runtime.heapTotalMb.toFixed(1)} MB allocated</p>
    </div>
    <div class="card stat-card">
      <p class="stat-label">CPU Usage</p>
      <p class="stat-value">${runtime.cpuPercent.toFixed(1)}%</p>
      <p class="stat-sub">Since the last sample</p>
    </div>
    <div class="card stat-card">
      <p class="stat-label">Buffer Size</p>
      <p class="stat-value">${formatNumber(runtime.bufferSize)}</p>
      <p class="stat-sub">Resource samples in memory</p>
    </div>
  </div>`;
}

function renderRateLimiting(data: StatsPageData): string {
  const { runtime } = data;
  const cacheHit =
    runtime.rateLimitCacheHitRate === null
      ? 'No samples yet'
      : `${(runtime.rateLimitCacheHitRate * 100).toFixed(0)}% cache hits`;
  const dynamic = runtime.rateLimitMode === 'dynamic';

  return `<h2>Rate Limiting</h2>
  <div class="stat-grid">
    <div class="card stat-card">
      <p class="stat-label">Mode</p>
      <p class="stat-value status-connected">● ${dynamic ? 'Dynamic per IP' : 'Fixed per IP'}</p>
      <p class="stat-sub">${dynamic ? 'API lookups · adapts to pressure' : 'Static per-IP API budget'}</p>
    </div>
    <div class="card stat-card">
      <p class="stat-label">API Budget</p>
      <p class="stat-value">${formatNumber(runtime.rateLimitBudget)}/min</p>
      <p class="stat-sub">${dynamic ? `Identifiers per client · ${formatNumber(runtime.rateLimitMin)}–${formatNumber(runtime.rateLimitMax)}/min` : 'Identifiers per client IP'}</p>
    </div>
    <div class="card stat-card">
      <p class="stat-label">Active Clients</p>
      <p class="stat-value">${formatNumber(runtime.rateLimitActiveClients)}</p>
      <p class="stat-sub">${formatNumber(runtime.rateLimitKeys)} tracked API buckets</p>
    </div>
    <div class="card stat-card">
      <p class="stat-label">Upstream Signal</p>
      <p class="stat-value">${formatNumber(runtime.rateLimitNetworkCalls)}/h</p>
      <p class="stat-sub">${cacheHit} · ${formatNumber(runtime.rateLimitHypixelRemaining)} quota left</p>
    </div>
  </div>
  <p class="meta">Cache hits refund their identifier cost; every request still counts against the ${formatNumber(runtime.rateLimitRequestBudget)}/min request guard.</p>`;
}

function legend(slices: { label: string; value: number; color: string }[], total: number): string {
  return `<ul class="legend">${slices
    .map(
      (slice) =>
        `<li><span class="dot" style="background:${slice.color}"></span>${escapeHtml(slice.label)} · ${formatNumber(slice.value)} (${total > 0 ? ((slice.value / total) * 100).toFixed(1) : '0.0'}%)</li>`,
    )
    .join('')}</ul>`;
}

function statusColor(label: string): string {
  const code = Number(label);
  if (code >= 500) return '#f87171';
  if (code >= 400) return '#fde047';
  if (code >= 300) return '#67e8f9';
  return '#4ade80';
}

function shortStarLabel(label: string): string {
  switch (label) {
    case '10-49':
      return '10s';
    case '50-99':
      return '50s';
    case '100-199':
      return '100s';
    case '200-299':
      return '200s';
    case '300-499':
      return '300s';
    case '500-999':
      return '500s';
    case '1000+':
      return '1k+';
    case 'Unknown':
      return '?';
    default:
      return label;
  }
}

function chartCard(title: string, hint: string, body: string, extra = ''): string {
  return `<div class="card">
    <div class="card-header"><h2>${escapeHtml(title)}</h2><span class="meta">${escapeHtml(hint)}</span></div>
    <div class="chart-shell">${body}</div>
    ${extra}
  </div>`;
}

function timeAxis(query: StatsQuery, series: TimePoint[]): string {
  if (series.length === 0) {
    return '';
  }
  const first = series[0].bucket;
  const last = series[series.length - 1].bucket;
  const short = (date: Date) =>
    query.range === '24h' && !query.from && !query.to
      ? `${String(date.getUTCHours()).padStart(2, '0')}:00`
      : `${date.getUTCMonth() + 1}/${date.getUTCDate()}`;
  return `<div class="chart-axis"><span>${escapeHtml(short(first))}</span><span>${escapeHtml(short(last))}</span></div>`;
}

function renderTopPlayers(players: TopPlayer[]): string {
  const max = Math.max(1, ...players.map((player) => player.count));
  const rows = players
    .map((player) => {
      const name = player.username ?? shortenUuid(player.identifier);
      const width = ((player.count / max) * 100).toFixed(1);
      return `<li>
        <span class="bar-list__label" title="${escapeHtml(name)}">${escapeHtml(name)}</span>
        <span class="bar-list__track"><span style="width:${width}%"></span></span>
        <span class="bar-list__value">${formatNumber(player.count)}</span>
      </li>`;
    })
    .join('');

  return `<div class="card">
    <div class="card-header"><h2>Top Queried Players</h2><span class="meta">Most lookups</span></div>
    <ul class="bar-list">${rows || '<li class="meta">No lookups yet.</li>'}</ul>
  </div>`;
}

function renderCharts(query: StatsQuery, data: StatsPageData): string {
  const { charts, summary } = data;
  const series = charts.series;
  const cacheSlices = [
    { label: 'Cache', value: summary.cacheHits, color: '#22d3ee' },
    { label: 'Network', value: Math.max(0, summary.total - summary.cacheHits), color: '#3b82f6' },
  ];
  const statusSlices = charts.statuses.map((slice) => ({
    label: slice.label,
    value: slice.count,
    color: statusColor(slice.label),
  }));
  const routeSlices = charts.routes.map((slice, index) => ({
    label: slice.label,
    value: slice.count,
    color: ['#3b82f6', '#22d3ee', '#a78bfa'][index % 3],
  }));
  const cacheRate = summary.total > 0 ? (summary.cacheHits / summary.total) * 100 : 0;
  const successRate = summary.total > 0 ? (summary.success / summary.total) * 100 : 0;
  const memory = data.runtime.samples;
  const lastBucket = series.length > 0 ? series[series.length - 1] : null;
  const lastMemory = memory.length > 0 ? memory[memory.length - 1] : null;
  const lastCacheRate =
    lastBucket && lastBucket.total > 0 ? (lastBucket.cacheHits / lastBucket.total) * 100 : 0;

  return `<div class="dashboard-grid">
    ${chartCard(
      'Cache Performance',
      'Hits vs network',
      donut(cacheSlices, `${cacheRate.toFixed(1)}%`, 'cache', `Cache hit rate ${cacheRate.toFixed(1)} percent`),
      legend(cacheSlices, summary.total),
    )}
    ${chartCard(
      'Star Distribution',
      'Players by stars',
      barChart(charts.stars.map((slice) => ({ label: slice.label, value: slice.count })), 'Players by BedWars star range'),
      barLabels(
        charts.stars.map((slice) => shortStarLabel(slice.label)),
        charts.stars.map((slice) => slice.count),
      ),
    )}
    ${chartCard(
      'Latency Pulse',
      `avg ${formatLatency(lastBucket?.avgLatency)} · p95 ${formatLatency(lastBucket?.p95Latency)}`,
      lineChart(
        [
          { values: series.map((point) => point.avgLatency), color: '#38bdf8', fill: true },
          { values: series.map((point) => point.p95Latency), color: '#a78bfa' },
        ],
        'Average and p95 latency over time',
      ),
      `${timeAxis(query, series)}<p class="meta chart-foot">Blue: average · purple: p95</p>`,
    )}
    ${chartCard(
      'Status Breakdown',
      'HTTP status codes',
      donut(statusSlices, `${successRate.toFixed(1)}%`, 'success', `HTTP status breakdown, ${successRate.toFixed(1)} percent success`),
      legend(statusSlices, summary.total),
    )}
    ${chartCard(
      'Request Routes',
      'Where lookups arrive',
      donut(routeSlices, formatNumber(summary.total), 'lookups', 'Lookups by route'),
      legend(routeSlices, summary.total),
    )}
    ${chartCard(
      'Requests Over Time',
      `Latest ${formatNumber(lastBucket?.total ?? 0)}`,
      lineChart([{ values: series.map((point) => point.total), color: '#38bdf8', fill: true }], 'Lookups over time'),
      timeAxis(query, series),
    )}
    ${chartCard(
      'Cache Hit Rate Over Time',
      `Latest ${lastCacheRate.toFixed(1)}%`,
      lineChart(
        [
          {
            values: series.map((point) => (point.total > 0 ? (point.cacheHits / point.total) * 100 : 0)),
            color: '#22d3ee',
            fill: true,
          },
        ],
        'Cache hit rate over time',
      ),
      timeAxis(query, series),
    )}
    ${chartCard(
      'Latency Distribution',
      'Sample counts',
      barChart(
        charts.latencyHistogram.map((slice) => ({ label: slice.label, value: slice.count })),
        'Latency distribution in milliseconds',
      ),
      barLabels(
        charts.latencyHistogram.map((slice) => slice.label),
        charts.latencyHistogram.map((slice) => slice.count),
      ),
    )}
    ${renderTopPlayers(charts.topPlayers)}
    ${chartCard(
      'Process Memory Over Time',
      `${(lastMemory?.rssMb ?? 0).toFixed(0)} MB RSS`,
      lineChart(
        [
          { values: memory.map((sample) => sample.rssMb), color: '#38bdf8', fill: true },
          { values: memory.map((sample) => sample.heapMb), color: '#22d3ee' },
        ],
        'Process memory over time',
      ),
      `<p class="meta chart-foot">Blue: RSS · cyan: heap · ${formatNumber(memory.length)} ${memory.length === 1 ? 'sample' : 'samples'}</p>`,
    )}
  </div>`;
}

function statusBadge(status: number): string {
  return `<span class="status-badge status-${Math.floor(status / 100)}xx">${escapeHtml(status)}</span>`;
}

function renderRow(row: LookupLogTable): string {
  const resolved = row.nicked ? '(nicked)' : row.username ?? 'unknown';
  const stars = row.stars === null ? '--' : formatNumber(row.stars);
  const source = row.source === 'cache' ? 'Cache' : 'Network';
  const profileUrl = `https://namemc.com/profile/${encodeURIComponent(row.identifier)}`;

  return `<tr>
    <td class="col-seen col-time" title="${escapeHtml(formatIsoMinute(row.looked_up_at))}">${escapeHtml(formatRelativeTime(row.looked_up_at))}</td>
    <td class="col-lookup"><a class="lookup-link" href="${profileUrl}" target="_blank" rel="noopener noreferrer">UUID: ${escapeHtml(shortenUuid(row.identifier))}</a></td>
    <td>${escapeHtml(resolved)}</td>
    <td class="stars">${escapeHtml(stars)}</td>
    <td class="col-source">${escapeHtml(source)}</td>
    <td class="col-source">${escapeHtml(row.route)}</td>
    <td>${statusBadge(row.status)}</td>
    <td class="col-latency latency">${escapeHtml(formatLatency(row.latency_ms))}</td>
  </tr>`;
}

function renderTable(query: StatsQuery, data: StatsPageData): string {
  const totalPages = Math.max(1, Math.ceil(data.matching / data.pageSize));
  const rows = data.rows.map(renderRow).join('');

  const body = rows
    ? `<div class="table-wrap"><table>
        <thead>
          <tr>
            <th scope="col" class="col-seen">Queried At</th>
            <th scope="col" class="col-lookup">Lookup</th>
            <th scope="col">Resolved</th>
            <th scope="col">Stars</th>
            <th scope="col" class="col-source">Source</th>
            <th scope="col" class="col-source">Route</th>
            <th scope="col">Status</th>
            <th scope="col" class="col-latency">Latency</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table></div>`
    : `<div class="empty-state">
        <strong>${query.search ? 'No lookups match this search' : 'No lookups recorded yet'}</strong>
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

  return `<h2>Recent Player Lookups</h2>
  <p class="meta">${plural(data.matching, 'lookup', 'lookups')} · page ${formatNumber(data.page)} of ${formatNumber(totalPages)}</p>
  <div class="controls">
    <form class="search-box" method="get" action="/stats">
      ${hiddenQuery(query, ['search', 'page'])}
      <input type="search" name="q" value="${escapeHtml(query.search)}" placeholder="Search by username or UUID" aria-label="Search players">
      <select name="sort" aria-label="Sort lookups">
        <option value="recent"${query.sort === 'recent' ? ' selected' : ''}>Recent first</option>
        <option value="slowest"${query.sort === 'slowest' ? ' selected' : ''}>Slowest first</option>
        <option value="stars"${query.sort === 'stars' ? ' selected' : ''}>Highest stars</option>
      </select>
      <button type="submit">Search</button>
      ${query.search ? `<a class="preset-btn" href="${statsHref(query, { search: '', page: 1 })}">Clear</a>` : ''}
    </form>
    <div class="pager">${previous} ${next}</div>
  </div>
  ${body}`;
}

export function renderStatsPage({ query, data, retentionDays }: StatsPageProps): string {
  const exportParams = queryParams(query);
  exportParams.delete('page');
  const exportHref = `/stats/export.csv${exportParams.size > 0 ? `?${exportParams}` : ''}`;

  return renderLayout({
    title: 'Levelhead Player Stats',
    heading: 'Levelhead Analytics',
    subtitle: 'Live snapshot of BedWars lookups (rendered locally, no external dashboards).',
    refreshSeconds: query.refresh,
    body: `${renderFilters(query, data)}
${renderStats(query, data)}
${renderInfrastructure(data)}
${renderProcess(data)}
${renderRateLimiting(data)}
${renderCharts(query, data)}
${renderTable(query, data)}
<div class="page-actions"><a class="apply-btn" href="${escapeHtml(exportHref)}">Download CSV</a></div>
<p class="meta page-foot">Lookup rows are pruned after ${formatNumber(retentionDays)} days · ${formatNumber(data.summary.cacheEntries)} cached profiles · database ${escapeHtml(data.summary.databaseSize)}</p>`,
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
export function renderLookupCsv(rows: LookupLogTable[]): string {
  const header = [
    'looked_up_at',
    'identifier',
    'username',
    'stars',
    'nicked',
    'source',
    'route',
    'status',
    'latency_ms',
  ];

  const lines = rows.map((row) =>
    [
      row.looked_up_at.toISOString(),
      row.identifier,
      row.username,
      row.stars,
      row.nicked,
      row.source,
      row.route,
      row.status,
      row.latency_ms,
    ]
      .map(csvCell)
      .join(','),
  );

  return [header.map(csvCell).join(','), ...lines].join('\n');
}
