import { Router } from 'express';
import {
  getPlayerQueryCount,
  getPlayerQueryPage,
  getPlayerQueriesWithFilters,
  getTopPlayersByQueryCount,
} from '../services/history';
import { escapeHtml } from '../util/html';

const router = Router();
const PAGE_SIZE = 25;

function formatDate(date: Date): string {
  return date.toISOString();
}

function timeAgo(date: Date): string {
  const seconds = Math.floor((new Date().getTime() - date.getTime()) / 1000);
  if (seconds < 0) return "just now";

  const intervals = [
    { label: 'year', seconds: 31536000 },
    { label: 'month', seconds: 2592000 },
    { label: 'day', seconds: 86400 },
    { label: 'hour', seconds: 3600 },
    { label: 'minute', seconds: 60 }
  ];

  for (const interval of intervals) {
    const count = Math.floor(seconds / interval.seconds);
    if (count >= 1) {
      return `${count} ${interval.label}${count !== 1 ? 's' : ''} ago`;
    }
  }

  return `${Math.floor(seconds)} second${Math.floor(seconds) !== 1 ? 's' : ''} ago`;
}

function formatStars(stars: number | null): string {
  if (stars === null || Number.isNaN(stars)) {
    return '--';
  }

  return `${stars}`;
}

function formatLatency(latency: number | null): string {
  if (latency === null || Number.isNaN(latency) || latency < 0) {
    return '--';
  }

  return `${latency.toLocaleString()} ms`;
}

router.get('/', async (req, res, next) => {
  try {
    const requestedPage = Number.parseInt((req.query.page as string) ?? '1', 10);
    const search = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const safePage = Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1;

    // Parse filter parameters
    const fromParam = typeof req.query.from === 'string' ? req.query.from : undefined;
    const toParam = typeof req.query.to === 'string' ? req.query.to : undefined;
    const limitParam = typeof req.query.limit === 'string' ? req.query.limit : undefined;

    const startDate = fromParam ? new Date(fromParam) : undefined;
    const endDate = toParam ? new Date(toParam) : undefined;
    const limit = limitParam ? Number.parseInt(limitParam, 10) : undefined;

    // Validate dates
    const validStartDate = startDate && !Number.isNaN(startDate.getTime()) ? startDate : undefined;
    const validEndDate = endDate && !Number.isNaN(endDate.getTime()) ? endDate : undefined;
    const MAX_ALLOWED_LIMIT = 10000;
    const DEFAULT_CHART_LIMIT = 200; // Default to 200 rows if no limit specified to prevent loading entire table
    const validLimit = limit !== undefined && Number.isFinite(limit)
      ? Math.min(Math.max(limit, 1), MAX_ALLOWED_LIMIT)
      : undefined;
    const hasTimeFilter = Boolean(validStartDate || validEndDate);
    // But if time filters are present, use MAX_ALLOWED_LIMIT to show all data in range
    const effectiveLimit = validLimit ?? (hasTimeFilter ? MAX_ALLOWED_LIMIT : DEFAULT_CHART_LIMIT);

    const totalCount = await getPlayerQueryCount({ search });
    const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
    const page = Math.min(safePage, totalPages);
    const pageData = await getPlayerQueryPage({ page, pageSize: PAGE_SIZE, search, totalCountOverride: totalCount });

    // Fetch filtered data for charts
    const [chartData, topPlayers] = await Promise.all([
      getPlayerQueriesWithFilters({
        startDate: validStartDate,
        endDate: validEndDate,
        limit: effectiveLimit,
      }),
      getTopPlayersByQueryCount({
        startDate: validStartDate,
        endDate: validEndDate,
        limit: 20,
      }),
    ]);

    // Serialise the data so the frontend script can use it
    // Securely escape < characters to prevent XSS via script injection
    const jsonForFrontend = JSON.stringify({
      chartData,
      topPlayers,
      filters: {
        from: validStartDate?.toISOString(),
        to: validEndDate?.toISOString(),
        limit: validLimit,
      },
    }).replace(/</g, '\\u003c');

    const rows = pageData.rows
      .map((entry) => {
        const lookupIdentifier =
          entry.lookupType === 'uuid' && entry.resolvedUsername
            ? entry.resolvedUsername
            : entry.identifier;
        const lookup = `${entry.lookupType.toUpperCase()}: ${lookupIdentifier}`;
        const resolved = entry.nicked === true ? '(nicked)' : entry.resolvedUsername ?? entry.resolvedUuid ?? 'unknown';
        const cacheSource = entry.cacheHit ? 'Cache' : entry.cacheSource === 'network' ? 'Network' : entry.cacheSource;

        // URL encode the identifier to prevent XSS in href
        const encodedIdentifier = encodeURIComponent(entry.identifier);
        const lookupLink = entry.lookupType === 'uuid'
          ? `https://namemc.com/profile/${encodedIdentifier}`
          : `https://namemc.com/search?q=${encodedIdentifier}`;

        return `<tr>
          <td title="${escapeHtml(formatDate(entry.requestedAt))}">${escapeHtml(timeAgo(entry.requestedAt))}</td>
          <td><a href="${lookupLink}" target="_blank" class="lookup-link">${escapeHtml(lookup)}</a></td>
          <td>${escapeHtml(resolved)}</td>
          <td class="stars">${escapeHtml(formatStars(entry.stars))}</td>
          <td>${escapeHtml(cacheSource)}${entry.revalidated ? ' <span class="tag">revalidated</span>' : ''}</td>
          <td>${entry.responseStatus}</td>
          <td class="latency">${escapeHtml(formatLatency(entry.latencyMs))}</td>
        </tr>`;
      })
      .join('\n');

    const html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Levelhead Player Stats</title>
    <link rel="icon" href="data:," />
    <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.3/dist/chart.umd.js" integrity="sha384-tgbB5AKnszdcfwcZtTfuhR3Ko1XZdlDfsLtkxiiAZiVkkXCkFmp+FQFh+V/UTo54" crossorigin="anonymous"></script>
    <style>
      :root {
        color-scheme: dark;
        font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: #0f172a;
        color: #e2e8f0;
        --chart-height: 320px;
      }
      body {
        padding: 1.5rem 1rem;
        margin: 0;
        max-width: none;
        width: 100%;
      }
      h1 {
        font-size: 1.75rem;
        margin-bottom: 0.5rem;
      }
      p.meta {
        margin-top: 0;
        color: #94a3b8;
        font-size: 0.9rem;
      }
      p.meta.hero {
        font-size: 1rem;
        color: #cbd5f5;
        margin-bottom: 0.75rem;
      }

      .stat-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        gap: 1rem;
        margin: 1rem 0 2rem;
      }
      .stat-card {
        display: flex;
        flex-direction: column;
        gap: 0.35rem;
        background: linear-gradient(135deg, rgba(59, 130, 246, 0.08), rgba(34, 211, 238, 0.08));
        border: 1px solid rgba(148, 163, 184, 0.2);
        box-shadow: 0 10px 30px rgba(15, 23, 42, 0.35);
      }
      .stat-label {
        color: #94a3b8;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        font-size: 0.75rem;
        margin: 0;
      }
      .stat-value {
        font-size: 1.65rem;
        font-weight: 700;
        margin: 0;
      }
      .stat-sub {
        margin: 0;
        color: #cbd5f5;
        font-size: 0.85rem;
      }
      .progress {
        height: 6px;
        background: rgba(148, 163, 184, 0.2);
        border-radius: 999px;
        overflow: hidden;
      }
      .progress span {
        display: block;
        height: 100%;
        background: linear-gradient(90deg, #22d3ee, #3b82f6);
        width: 0;
        transition: width 0.4s ease;
      }

      /* NEW CSS FOR GRAPHS */
      .dashboard-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
        gap: 1.5rem;
        margin-bottom: 2rem;
      }
      .chart-toolbar {
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.75rem 1rem;
        background: rgba(30, 41, 59, 0.6);
        border: 1px solid rgba(148, 163, 184, 0.2);
        border-radius: 10px;
        margin-bottom: 1rem;
      }
      .chart-toolbar label {
        color: #cbd5f5;
        font-weight: 600;
      }
      .chart-toolbar input[type="range"] {
        accent-color: #38bdf8;
      }
      .chart-shell {
        position: relative;
        height: var(--chart-height);
      }
      .chart-shell canvas {
        width: 100% !important;
        height: 100% !important;
      }
      .card {
        background: rgba(30, 41, 59, 0.5);
        border: 1px solid rgba(148, 163, 184, 0.15);
        border-radius: 12px;
        padding: 1rem;
      }
      h2 { font-size: 1rem; color: #94a3b8; margin-top: 0; }

      .lookup-link {
        color: #60a5fa;
        text-decoration: none;
      }

      table {
        width: 100%;
        border-collapse: collapse;
        margin-top: 1.5rem;
        background: rgba(15, 23, 42, 0.6);
        border: 1px solid rgba(148, 163, 184, 0.15);
        border-radius: 12px;
        overflow: hidden;
      }
      thead {
        background: rgba(30, 41, 59, 0.9);
      }
      th, td {
        padding: 0.75rem 1rem;
        text-align: left;
        border-bottom: 1px solid rgba(148, 163, 184, 0.1);
      }
      th {
        font-weight: 600;
        font-size: 0.85rem;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: #cbd5f5;
      }
      tr:last-child td {
        border-bottom: none;
      }
      tr:nth-child(even) td {
        background: rgba(148, 163, 184, 0.05);
      }
      .stars {
        font-weight: 600;
        font-variant-numeric: tabular-nums;
      }
      .latency {
        font-variant-numeric: tabular-nums;
        color: #cbd5f5;
      }
      .tag {
        display: inline-flex;
        align-items: center;
        gap: 0.25rem;
        padding: 0 0.4rem;
        border-radius: 999px;
        background: rgba(96, 165, 250, 0.2);
        color: #93c5fd;
        font-size: 0.75rem;
        font-weight: 600;
      }
      @media (max-width: 960px) {
        table {
          font-size: 0.85rem;
        }
        th, td {
          padding: 0.6rem 0.75rem;
        }
      }
      .controls {
        display: flex;
        flex-wrap: wrap;
        gap: 0.75rem;
        align-items: center;
        justify-content: space-between;
        margin-top: 0.75rem;
      }
      .search-box {
        display: flex;
        gap: 0.5rem;
      }
      .search-box input {
        padding: 0.5rem 0.75rem;
        border-radius: 8px;
        border: 1px solid rgba(148, 163, 184, 0.3);
        background: rgba(30, 41, 59, 0.5);
        color: #e2e8f0;
      }
      .search-box button,
      .pager button {
        padding: 0.5rem 0.85rem;
        border-radius: 8px;
        border: 1px solid rgba(148, 163, 184, 0.35);
        background: rgba(59, 130, 246, 0.15);
        color: #cbd5f5;
        font-weight: 600;
        cursor: pointer;
      }
      .pager {
        display: flex;
        gap: 0.5rem;
        align-items: center;
      }
      .pager button[disabled] {
        opacity: 0.4;
        cursor: not-allowed;
      }
      .muted {
        color: #94a3b8;
        font-size: 0.9rem;
        margin: 0;
      }
      .filter-controls {
        background: rgba(30, 41, 59, 0.6);
        border: 1px solid rgba(148, 163, 184, 0.2);
        border-radius: 12px;
        padding: 1.5rem;
        margin-bottom: 2rem;
      }
      .filter-form {
        display: flex;
        flex-wrap: wrap;
        gap: 1rem;
        align-items: flex-end;
      }
      .filter-group {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }
      .filter-group label {
        color: #cbd5f5;
        font-weight: 600;
        font-size: 0.85rem;
      }
      .filter-group input {
        padding: 0.5rem 0.75rem;
        border-radius: 8px;
        border: 1px solid rgba(148, 163, 184, 0.3);
        background: rgba(15, 23, 42, 0.8);
        color: #e2e8f0;
        font-size: 0.9rem;
      }
      .filter-group input[type="number"] {
        width: 120px;
      }
      .filter-presets {
        display: flex;
        gap: 0.5rem;
        flex-wrap: wrap;
      }
      .preset-btn, .apply-btn, .reset-btn {
        padding: 0.5rem 1rem;
        border-radius: 8px;
        border: 1px solid rgba(148, 163, 184, 0.35);
        background: rgba(59, 130, 246, 0.15);
        color: #cbd5f5;
        font-weight: 600;
        cursor: pointer;
        font-size: 0.9rem;
      }
      .preset-btn:hover, .apply-btn:hover {
        background: rgba(59, 130, 246, 0.25);
      }
      .reset-btn {
        background: rgba(239, 68, 68, 0.15);
      }
      .reset-btn:hover {
        background: rgba(239, 68, 68, 0.25);
      }
      .filter-actions {
        display: flex;
        gap: 0.5rem;
      }
      .filter-summary {
        margin-top: 1rem;
        padding-top: 1rem;
        border-top: 1px solid rgba(148, 163, 184, 0.2);
      }
      .card {
        position: relative;
      }
      .expand-btn {
        position: absolute;
        top: 0.75rem;
        right: 0.75rem;
        background: rgba(59, 130, 246, 0.2);
        border: 1px solid rgba(148, 163, 184, 0.3);
        color: #cbd5f5;
        padding: 0.4rem 0.6rem;
        border-radius: 6px;
        cursor: pointer;
        font-size: 0.85rem;
        font-weight: 600;
        z-index: 10;
        transition: background 0.2s;
      }
      .expand-btn:hover {
        background: rgba(59, 130, 246, 0.35);
      }
      .fullscreen-overlay {
        display: none;
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(15, 23, 42, 0.95);
        z-index: 9999;
        padding: 2rem;
        overflow: auto;
      }
      .fullscreen-overlay.active {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
      }
      .fullscreen-chart-container {
        background: rgba(30, 41, 59, 0.95);
        border: 1px solid rgba(148, 163, 184, 0.3);
        border-radius: 12px;
        padding: 2rem;
        max-width: 95vw;
        max-height: 95vh;
        width: 100%;
        position: relative;
      }
      .fullscreen-chart-title {
        font-size: 1.25rem;
        color: #cbd5f5;
        margin-bottom: 1rem;
        font-weight: 600;
      }
      .fullscreen-chart-shell {
        position: relative;
        height: calc(95vh - 120px);
        min-height: 400px;
      }
      .fullscreen-close-btn {
        position: absolute;
        top: 1rem;
        right: 1rem;
        background: rgba(239, 68, 68, 0.2);
        border: 1px solid rgba(148, 163, 184, 0.3);
        color: #cbd5f5;
        padding: 0.5rem 0.75rem;
        border-radius: 6px;
        cursor: pointer;
        font-size: 0.9rem;
        font-weight: 600;
        z-index: 10;
      }
      .fullscreen-close-btn:hover {
        background: rgba(239, 68, 68, 0.35);
      }
      .latency-chart-controls {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        margin-bottom: 0.75rem;
      }
      .latency-chart-controls label {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        color: #cbd5f5;
        font-size: 0.85rem;
        font-weight: 600;
        cursor: pointer;
      }
      .latency-chart-controls input[type="checkbox"] {
        accent-color: #38bdf8;
        cursor: pointer;
      }
      .stat-card-controls {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        margin-top: 0.5rem;
      }
      .stat-card-controls select {
        padding: 0.35rem 0.5rem;
        border-radius: 6px;
        border: 1px solid rgba(148, 163, 184, 0.3);
        background: rgba(15, 23, 42, 0.8);
        color: #e2e8f0;
        font-size: 0.75rem;
        cursor: pointer;
      }
    </style>
  </head>
  <body>
    <h1>Levelhead Analytics</h1>
    <p class="meta hero">Live snapshot of BedWars lookups (rendered locally, no external dashboards).</p>

    <div class="filter-controls">
      <form id="filterForm" method="GET" class="filter-form">
        <input type="hidden" name="page" value="1" />
        ${search ? `<input type="hidden" name="q" value="${escapeHtml(search)}" />` : ''}
        <div class="filter-group">
          <label for="fromDate">From:</label>
          <input type="datetime-local" id="fromDate" name="from" />
        </div>
        <div class="filter-group">
          <label for="toDate">To:</label>
          <input type="datetime-local" id="toDate" name="to" />
        </div>
        <div class="filter-group">
          <label for="limitInput">Limit:</label>
          <input type="number" id="limitInput" name="limit" placeholder="All" min="1" />
        </div>
        <div class="filter-presets">
          <button type="button" class="preset-btn" data-preset="1h">Last Hour</button>
          <button type="button" class="preset-btn" data-preset="24h">Last 24h</button>
          <button type="button" class="preset-btn" data-preset="7d">Last 7 Days</button>
          <button type="button" class="preset-btn" data-preset="all">All Time</button>
        </div>
        <div class="filter-actions">
          <button type="submit" class="apply-btn">Apply Filters</button>
          <button type="button" class="reset-btn" id="resetFilters">Reset</button>
        </div>
      </form>
      <p class="meta filter-summary" id="filterSummary"></p>
    </div>

    <div class="stat-grid">
      <div class="card stat-card">
        <p class="stat-label">Total Lookups</p>
        <p class="stat-value" id="totalLookupsValue">--</p>
        <p class="stat-sub" id="totalLookupsSub">Filtered data</p>
      </div>
      <div class="card stat-card">
        <p class="stat-label">Cache Hit Rate</p>
        <p class="stat-value" id="cacheHitRateValue">--</p>
        <div class="progress"><span id="cacheHitProgress"></span></div>
        <p class="stat-sub">Measured from recent lookups</p>
      </div>
      <div class="card stat-card">
        <p class="stat-label">Success Rate</p>
        <p class="stat-value" id="successRateValue">--</p>
        <div class="progress"><span id="successRateProgress"></span></div>
        <p class="stat-sub">Based on HTTP status codes</p>
      </div>
      <div class="card stat-card">
        <p class="stat-label" id="latencyLabel">Latency (p95)</p>
        <p class="stat-value" id="latencyP95Value">--</p>
        <p class="stat-sub">Derived from real latency samples</p>
        <div class="stat-card-controls">
          <label for="latencyMetricSelect">Metric:</label>
          <select id="latencyMetricSelect">
            <option value="p50">p50 (Median)</option>
            <option value="p95" selected>p95</option>
            <option value="p99">p99</option>
            <option value="min">Min</option>
            <option value="max">Max</option>
            <option value="avg">Average</option>
          </select>
        </div>
      </div>
    </div>

    <div class="chart-toolbar">
      <label for="chartHeightRange">Chart height</label>
      <input id="chartHeightRange" type="range" min="200" max="500" value="320" step="20" />
      <span id="chartHeightValue">320px</span>
    </div>

    <div class="dashboard-grid">
      <div class="card">
        <h2>Cache Performance</h2>
        <button class="expand-btn" data-chart-id="cacheChart" data-chart-title="Cache Performance">Expand</button>
        <div class="chart-shell"><canvas id="cacheChart"></canvas></div>
      </div>
      <div class="card">
        <h2>Star Distribution</h2>
        <button class="expand-btn" data-chart-id="starChart" data-chart-title="Star Distribution">Expand</button>
        <div class="chart-shell"><canvas id="starChart"></canvas></div>
      </div>
      <div class="card">
        <h2>Latency Pulse</h2>
        <button class="expand-btn" data-chart-id="latencyChart" data-chart-title="Latency Pulse">Expand</button>
        <div class="latency-chart-controls">
          <label>
            <input type="checkbox" id="includeCacheHits" checked />
            Include cache hits
          </label>
        </div>
        <div class="chart-shell"><canvas id="latencyChart"></canvas></div>
      </div>
      <div class="card">
        <h2>Status Breakdown</h2>
        <button class="expand-btn" data-chart-id="statusChart" data-chart-title="Status Breakdown">Expand</button>
        <div class="chart-shell"><canvas id="statusChart"></canvas></div>
      </div>
      <div class="card">
        <h2>Lookup Type Distribution</h2>
        <button class="expand-btn" data-chart-id="lookupTypeChart" data-chart-title="Lookup Type Distribution">Expand</button>
        <div class="chart-shell"><canvas id="lookupTypeChart"></canvas></div>
      </div>
      <div class="card">
        <h2>Requests Over Time</h2>
        <button class="expand-btn" data-chart-id="requestsOverTimeChart" data-chart-title="Requests Over Time">Expand</button>
        <div class="chart-shell"><canvas id="requestsOverTimeChart"></canvas></div>
      </div>
      <div class="card">
        <h2>Cache Hit Rate Over Time</h2>
        <button class="expand-btn" data-chart-id="cacheOverTimeChart" data-chart-title="Cache Hit Rate Over Time">Expand</button>
        <div class="chart-shell"><canvas id="cacheOverTimeChart"></canvas></div>
      </div>
      <div class="card">
        <h2>Latency Distribution</h2>
        <button class="expand-btn" data-chart-id="latencyDistributionChart" data-chart-title="Latency Distribution">Expand</button>
        <div class="chart-shell"><canvas id="latencyDistributionChart"></canvas></div>
      </div>
      <div class="card">
        <h2>Top Queried Players</h2>
        <button class="expand-btn" data-chart-id="topPlayersChart" data-chart-title="Top Queried Players">Expand</button>
        <div class="chart-shell"><canvas id="topPlayersChart"></canvas></div>
      </div>
    </div>

    <div class="fullscreen-overlay" id="fullscreenOverlay">
      <div class="fullscreen-chart-container">
        <button class="fullscreen-close-btn" id="fullscreenCloseBtn">Close (ESC)</button>
        <div class="fullscreen-chart-title" id="fullscreenChartTitle"></div>
        <div class="fullscreen-chart-shell">
          <canvas id="fullscreenChart"></canvas>
        </div>
      </div>
    </div>

    <h2>Recent Player Lookups</h2>
    <p class="meta">${pageData.totalCount === 0 ? 'No lookups recorded yet.' : `Showing page ${page} of ${totalPages} (${pageData.totalCount} total lookups).`}</p>
    <div class="controls">
      <form class="search-box" method="GET">
        <input
          type="text"
          name="q"
          placeholder="Search by username or UUID"
          value="${escapeHtml(search)}"
        />
        <input type="hidden" name="page" value="1" />
        <button type="submit">Search</button>
      </form>
      <div class="pager">
        <form method="GET">
          <input type="hidden" name="page" value="${page - 1}" />
          <input type="hidden" name="q" value="${escapeHtml(search)}" />
          <button type="submit" ${page <= 1 ? 'disabled' : ''}>Previous</button>
        </form>
        <p class="muted">Page ${page} of ${totalPages}</p>
        <form method="GET">
          <input type="hidden" name="page" value="${page + 1}" />
          <input type="hidden" name="q" value="${escapeHtml(search)}" />
          <button type="submit" ${page >= totalPages ? 'disabled' : ''}>Next</button>
        </form>
      </div>
    </div>
    <table>
      <thead>
        <tr>
          <th>Queried At</th>
          <th>Lookup</th>
          <th>Resolved</th>
          <th>Stars</th>
          <th>Source</th>
          <th>Status</th>
          <th>Latency</th>
        </tr>
      </thead>
      <tbody>
        ${rows || '<tr><td colspan="7">No lookups recorded yet.</td></tr>'}
      </tbody>
    </table>

    <script>
      const pageData = ${jsonForFrontend};
      const data = pageData.chartData || [];
      const topPlayers = pageData.topPlayers || [];
      const filters = pageData.filters || {};
      const charts = [];
      // Store original chart configs for fullscreen cloning (avoids Chart.js resolver issues)
      const chartConfigs = new Map();

      // Safe deep clone helper that preserves functions but skips Chart.js internal properties
      function safeCloneConfig(obj, depth = 0) {
        if (depth > 10) return null; // Prevent infinite recursion
        if (obj === null || obj === undefined) return obj;
        if (typeof obj === 'function') return obj; // Preserve functions
        if (typeof obj !== 'object') return obj;
        
        // Skip Chart.js resolver objects (they have internal properties)
        if (typeof obj === 'object' && obj !== null) {
          if ('_resolve' in obj || '_scriptable' in obj || '_fallback' in obj) {
            return undefined;
          }
        }
        
        // Handle arrays
        if (Array.isArray(obj)) {
          return obj.map(item => safeCloneConfig(item, depth + 1)).filter(item => item !== undefined);
        }
        
        // Handle plain objects
        const cloned = {};
        for (const key in obj) {
          if (!key || key.startsWith('_')) continue; // Skip internal properties
          const value = obj[key];
          
          // Skip objects that look like resolvers
          if (typeof value === 'object' && value !== null) {
            if ('_resolve' in value || '_scriptable' in value || '_fallback' in value) {
              continue;
            }
          }
          
          const clonedValue = safeCloneConfig(value, depth + 1);
          if (clonedValue !== undefined) {
            cloned[key] = clonedValue;
          }
        }
        return cloned;
      }

      // Initialize filter controls
      const fromDateInput = document.getElementById('fromDate');
      const toDateInput = document.getElementById('toDate');
      const limitInput = document.getElementById('limitInput');
      const filterForm = document.getElementById('filterForm');
      const resetBtn = document.getElementById('resetFilters');
      const filterSummary = document.getElementById('filterSummary');

      // Set filter values from URL params
      if (filters.from && fromDateInput) {
        const fromDate = new Date(filters.from);
        if (!Number.isNaN(fromDate.getTime())) {
          // Convert to local time for datetime-local input
          const localDate = new Date(fromDate.getTime() - fromDate.getTimezoneOffset() * 60000);
          fromDateInput.value = localDate.toISOString().slice(0, 16);
        }
      }
      if (filters.to && toDateInput) {
        const toDate = new Date(filters.to);
        if (!Number.isNaN(toDate.getTime())) {
          // Convert to local time for datetime-local input
          const localDate = new Date(toDate.getTime() - toDate.getTimezoneOffset() * 60000);
          toDateInput.value = localDate.toISOString().slice(0, 16);
        }
      }
      if (filters.limit && limitInput) {
        limitInput.value = filters.limit;
      }

      // Update filter summary
      function updateFilterSummary() {
        if (!filterSummary) return;
        const parts = [];
        if (filters.from) {
          parts.push(\`from \${new Date(filters.from).toLocaleString()}\`);
        }
        if (filters.to) {
          parts.push(\`to \${new Date(filters.to).toLocaleString()}\`);
        }
        if (filters.limit) {
          parts.push(\`limit: \${filters.limit}\`);
        }
        filterSummary.textContent = parts.length > 0
          ? \`Showing data: \${parts.join(', ')}\`
          : 'Showing all data (no filters applied)';
      }
      updateFilterSummary();

      // Preset button handlers
      document.querySelectorAll('.preset-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const preset = btn.getAttribute('data-preset');
          const now = new Date();
          if (preset === '1h') {
            const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
            if (fromDateInput) {
              const localFrom = new Date(oneHourAgo.getTime() - oneHourAgo.getTimezoneOffset() * 60000);
              fromDateInput.value = localFrom.toISOString().slice(0, 16);
            }
            if (toDateInput) {
              const localTo = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
              toDateInput.value = localTo.toISOString().slice(0, 16);
            }
            if (limitInput) limitInput.value = '';
          } else if (preset === '24h') {
            const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
            if (fromDateInput) {
              const localFrom = new Date(oneDayAgo.getTime() - oneDayAgo.getTimezoneOffset() * 60000);
              fromDateInput.value = localFrom.toISOString().slice(0, 16);
            }
            if (toDateInput) {
              const localTo = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
              toDateInput.value = localTo.toISOString().slice(0, 16);
            }
            if (limitInput) limitInput.value = '';
          } else if (preset === '7d') {
            const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
            if (fromDateInput) {
              const localFrom = new Date(sevenDaysAgo.getTime() - sevenDaysAgo.getTimezoneOffset() * 60000);
              fromDateInput.value = localFrom.toISOString().slice(0, 16);
            }
            if (toDateInput) {
              const localTo = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
              toDateInput.value = localTo.toISOString().slice(0, 16);
            }
            if (limitInput) limitInput.value = '';
          } else if (preset === 'all') {
            if (fromDateInput) fromDateInput.value = '';
            if (toDateInput) toDateInput.value = '';
            if (limitInput) limitInput.value = '';
          }
        });
      });

      // Reset button handler
      if (resetBtn) {
        resetBtn.addEventListener('click', () => {
          const url = new URL(window.location.href);
          url.searchParams.delete('from');
          url.searchParams.delete('to');
          url.searchParams.delete('limit');
          url.searchParams.set('page', '1');
          window.location.href = url.toString();
        });
      }

      const chartHeightControl = document.getElementById('chartHeightRange');
      const chartHeightValue = document.getElementById('chartHeightValue');
      const defaultChartHeight = Number(chartHeightControl?.value ?? 320);
      let currentChartHeight = defaultChartHeight;

      function applyChartHeight(px) {
        const numeric = Number(px);
        const clamped = Number.isFinite(numeric) ? Math.min(500, Math.max(200, numeric)) : defaultChartHeight;
        currentChartHeight = clamped;
        document.documentElement.style.setProperty('--chart-height', clamped + 'px');
        if (chartHeightControl) chartHeightControl.value = clamped.toString();
        if (chartHeightValue) chartHeightValue.textContent = clamped + 'px';
        charts.forEach((chart) => chart.resize());
        try {
          window.localStorage.setItem('chartHeightPx', clamped.toString());
        } catch {
          // ignore persistence errors
        }
        return clamped;
      }

      const savedHeight = (() => {
        try {
          return Number.parseInt(window.localStorage.getItem('chartHeightPx') ?? '', 10);
        } catch {
          return Number.NaN;
        }
      })();

      applyChartHeight(Number.isFinite(savedHeight) && savedHeight > 0 ? savedHeight : defaultChartHeight);

      chartHeightControl?.addEventListener('input', (event) => {
        applyChartHeight((event.target)?.value ?? defaultChartHeight);
      });

      // Helper: percentile for latency stats
      function percentile(values, p) {
        if (values.length === 0) return null;
        const sorted = [...values].sort((a, b) => a - b);
        const rank = (p / 100) * (sorted.length - 1);
        const lower = Math.floor(rank);
        const upper = Math.ceil(rank);
        if (lower === upper) return sorted[lower];
        const weight = rank - lower;
        return sorted[lower] * (1 - weight) + sorted[upper] * weight;
      }

      // 1. Prepare Cache + traffic data
      const cacheHits = data.filter((d) => d.cacheHit).length;
      const cacheMisses = data.length - cacheHits;

      // 2. Prepare star data (group by range)
      const starRanges = { Unknown: 0, '0-10': 0, '11-50': 0, '51-100': 0, '100+': 0 };

      data.forEach((d) => {
        if (d.stars === null || d.stars === undefined || d.stars < 0) {
          starRanges.Unknown++;
          return;
        }

        const s = d.stars;
        if (s <= 10) starRanges['0-10']++;
        else if (s <= 50) starRanges['11-50']++;
        else if (s <= 100) starRanges['51-100']++;
        else starRanges['100+']++;
      });

      // 3. Build headline metrics from recent activity
      const totalLookups = data.length;
      const successCount = data.filter((d) => d.responseStatus >= 200 && d.responseStatus < 400).length;
      const successRate = totalLookups === 0 ? 0 : Math.round((successCount / totalLookups) * 1000) / 10;
      const cacheHitRate = totalLookups === 0 ? 0 : Math.round((cacheHits / totalLookups) * 1000) / 10;

      const latencyValues = data
        .map((d) => (typeof d.latencyMs === 'number' && d.latencyMs >= 0 ? d.latencyMs : null))
        .filter((v) => v !== null);
      
      // Calculate all latency metrics
      const latencyMetrics = {
        p50: percentile(latencyValues, 50),
        p95: percentile(latencyValues, 95),
        p99: percentile(latencyValues, 99),
        min: latencyValues.length > 0 ? Math.min(...latencyValues) : null,
        max: latencyValues.length > 0 ? Math.max(...latencyValues) : null,
        avg: latencyValues.length
          ? latencyValues.reduce((sum, value) => sum + (value ?? 0), 0) / latencyValues.length
          : null,
      };
      
      const latencyP95 = latencyMetrics.p95;
      const latencyAvg = latencyMetrics.avg;

      const statusBuckets = { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0, Other: 0 };
      data.forEach((d) => {
        if (d.responseStatus >= 200 && d.responseStatus < 300) statusBuckets['2xx']++;
        else if (d.responseStatus >= 300 && d.responseStatus < 400) statusBuckets['3xx']++;
        else if (d.responseStatus >= 400 && d.responseStatus < 500) statusBuckets['4xx']++;
        else if (d.responseStatus >= 500 && d.responseStatus < 600) statusBuckets['5xx']++;
        else statusBuckets.Other++;
      });

      const sortedByRequestTime = [...data].sort(
        (a, b) => new Date(a.requestedAt).getTime() - new Date(b.requestedAt).getTime(),
      );
      
      // Store original latency series for filtering
      const allLatencySeries = sortedByRequestTime.map((d) => ({
        x: new Date(d.requestedAt),
        y: typeof d.latencyMs === 'number' && d.latencyMs >= 0 ? d.latencyMs : null,
        cacheHit: d.cacheHit || false,
      }));
      
      // Default: include cache hits
      let includeCacheHits = true;
      let latencySeries = allLatencySeries.filter((point) => includeCacheHits || !point.cacheHit);

      function setMetric(id, value) {
        const el = document.getElementById(id);
        if (el) el.textContent = value;
      }

      function setProgress(id, percentage) {
        const el = document.getElementById(id);
        if (el) el.style.width = Math.max(0, Math.min(100, percentage)) + '%';
      }

      setMetric('totalLookupsValue', totalLookups.toLocaleString());
      const totalLookupsSub = document.getElementById('totalLookupsSub');
      if (totalLookupsSub) {
        if (filters.limit) {
          totalLookupsSub.textContent = \`Showing \${totalLookups.toLocaleString()} of \${filters.limit} limit\`;
        } else {
          totalLookupsSub.textContent = \`\${totalLookups.toLocaleString()} total lookups\`;
        }
      }
      setMetric('cacheHitRateValue', cacheHitRate.toFixed(1) + '%');
      setProgress('cacheHitProgress', cacheHitRate);
      setMetric('successRateValue', successRate.toFixed(1) + '%');
      setProgress('successRateProgress', successRate);
      
      // Latency metric selection handler
      const latencyMetricSelect = document.getElementById('latencyMetricSelect');
      const latencyLabel = document.getElementById('latencyLabel');
      let selectedLatencyMetric = 'p95';
      
      function updateLatencyDisplay() {
        const metricValue = latencyMetrics[selectedLatencyMetric];
        const displayValue = metricValue === null ? '--' : Math.round(metricValue).toLocaleString() + ' ms';
        setMetric('latencyP95Value', displayValue);
        
        // Update label
        const metricLabels = {
          p50: 'Latency (p50)',
          p95: 'Latency (p95)',
          p99: 'Latency (p99)',
          min: 'Latency (Min)',
          max: 'Latency (Max)',
          avg: 'Latency (Average)',
        };
        if (latencyLabel) {
          latencyLabel.textContent = metricLabels[selectedLatencyMetric] || 'Latency';
        }
      }
      
      if (latencyMetricSelect) {
        // Load saved preference
        try {
          const saved = window.localStorage.getItem('latencyMetric');
          if (saved && latencyMetrics[saved] !== undefined) {
            selectedLatencyMetric = saved;
            latencyMetricSelect.value = saved;
          }
        } catch {
          // ignore
        }
        
        latencyMetricSelect.addEventListener('change', (e) => {
          selectedLatencyMetric = e.target.value;
          updateLatencyDisplay();
          try {
            window.localStorage.setItem('latencyMetric', selectedLatencyMetric);
          } catch {
            // ignore
          }
        });
      }
      
      updateLatencyDisplay();

      // Render Pie Chart (Cache)
      const cacheChartConfig = {
        type: 'doughnut',
        data: {
          labels: ['Cache Hit', 'Network Fetch'],
          datasets: [{
            data: [cacheHits, cacheMisses],
            backgroundColor: ['#3b82f6', '#ef4444'], // Blue / Red
            borderWidth: 0
          }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { 
                    position: 'bottom', 
                    labels: { color: '#cbd5f5' } 
                },
                title: { display: false }
            }
        }
      };
      const cacheChartEl = document.getElementById('cacheChart');
      chartConfigs.set('cacheChart', safeCloneConfig(cacheChartConfig));
      charts.push(new Chart(cacheChartEl, cacheChartConfig));

      // Render Bar Chart (Stars)
      const starChartConfig = {
        type: 'bar',
        data: {
          labels: Object.keys(starRanges),
          datasets: [{
            label: 'Player Count',
            data: Object.values(starRanges),
            // Use a grey color for 'Unknown' to distinguish it, green for valid ranks
            backgroundColor: (ctx) => {
                // Check the label from the chart data to be robust
                const label = ctx.chart.data.labels[ctx.dataIndex];
                return label === 'Unknown' ? '#64748b' : '#10b981';
            },
            borderRadius: 4
          }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    ticks: { color: '#94a3b8', precision: 0 },
                    grid: { color: '#334155' },
                    beginAtZero: true
                },
                x: {
                    ticks: { color: '#94a3b8' },
                    grid: { display: false }
                }
            },
            plugins: { legend: { display: false } }
        }
      };
      const starChartEl = document.getElementById('starChart');
      chartConfigs.set('starChart', safeCloneConfig(starChartConfig));
      charts.push(new Chart(starChartEl, starChartConfig));

      function updateLatencyChart() {
        // Filter latency series based on cache hit inclusion
        const filteredSeries = includeCacheHits
          ? allLatencySeries
          : allLatencySeries.filter((point) => !point.cacheHit);
        
        const filteredLabels = filteredSeries.map((point) => {
          const asDate = point.x instanceof Date ? point.x : new Date(point.x);
          if (Number.isNaN(asDate.getTime())) return '';
          return asDate.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
        });
        
        // Find existing latency chart and update it
        const latencyChartIndex = charts.findIndex((chart) => chart.canvas.id === 'latencyChart');
        if (latencyChartIndex >= 0) {
          const chart = charts[latencyChartIndex];
          chart.data.labels = filteredLabels;
          chart.data.datasets[0].data = filteredSeries.map((point) => point.y);
          chart.update('none'); // Update without animation for better performance
        }
      }
      
      const latencyLabels = sortedByRequestTime.map((d, index) => {
        const asDate = new Date(d.requestedAt);
        if (Number.isNaN(asDate.getTime())) return 'Lookup ' + (index + 1);
        return asDate.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
      });

      const latencyChartConfig = {
        type: 'line',
        data: {
          labels: latencyLabels,
          datasets: [{
            label: 'Latency (ms)',
            data: latencySeries.map((point) => point.y),
            borderColor: '#38bdf8',
            backgroundColor: 'rgba(56, 189, 248, 0.2)',
            tension: 0.35,
            spanGaps: true,
            pointRadius: 0,
            pointHitRadius: 6,
            fill: true,
          }],
        },
        options: {
          responsive: true,
          scales: {
            y: {
              ticks: { color: '#94a3b8' },
              grid: { color: '#1f2937' },
              beginAtZero: true,
            },
            x: {
              ticks: { color: '#94a3b8', maxRotation: 45, minRotation: 0 },
              grid: { display: false },
            },
          },
          plugins: { legend: { display: false } },
          maintainAspectRatio: false,
        },
      };
      const latencyChartEl = document.getElementById('latencyChart');
      chartConfigs.set('latencyChart', safeCloneConfig(latencyChartConfig));
      const latencyChart = new Chart(latencyChartEl, latencyChartConfig);
      charts.push(latencyChart);
      
      // Cache hit toggle handler
      const includeCacheHitsCheckbox = document.getElementById('includeCacheHits');
      if (includeCacheHitsCheckbox) {
        includeCacheHitsCheckbox.addEventListener('change', (e) => {
          includeCacheHits = e.target.checked;
          updateLatencyChart();
        });
      }

      const statusChartConfig = {
        type: 'doughnut',
        data: {
          labels: Object.keys(statusBuckets),
          datasets: [{
            data: Object.values(statusBuckets),
            backgroundColor: ['#22c55e', '#22d3ee', '#facc15', '#ef4444', '#a855f7'],
            borderWidth: 0,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { 
              position: 'bottom', 
              labels: { color: '#cbd5f5' } 
            },
            title: { display: false },
          },
        },
      };
      const statusChartEl = document.getElementById('statusChart');
      chartConfigs.set('statusChart', safeCloneConfig(statusChartConfig));
      charts.push(new Chart(statusChartEl, statusChartConfig));

      // 5. Lookup Type Distribution
      const lookupTypeCounts = { UUID: 0, IGN: 0 };
      data.forEach((d) => {
        if (d.lookupType === 'uuid') {
          lookupTypeCounts.UUID++;
        } else {
          lookupTypeCounts.IGN++;
        }
      });
      const lookupTypeChartConfig = {
        type: 'doughnut',
        data: {
          labels: ['UUID', 'IGN'],
          datasets: [{
            data: [lookupTypeCounts.UUID, lookupTypeCounts.IGN],
            backgroundColor: ['#8b5cf6', '#ec4899'],
            borderWidth: 0,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { 
              position: 'bottom', 
              labels: { color: '#cbd5f5' } 
            },
            title: { display: false },
          },
        },
      };
      const lookupTypeChartEl = document.getElementById('lookupTypeChart');
      chartConfigs.set('lookupTypeChart', safeCloneConfig(lookupTypeChartConfig));
      charts.push(new Chart(lookupTypeChartEl, lookupTypeChartConfig));

      // 6. Requests Over Time
      function getTimeBucketInterval(startDate, endDate) {
        if (!startDate || !endDate || Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
          return 60 * 60 * 1000; // Default to 1 hour
        }
        const rangeMs = endDate.getTime() - startDate.getTime();
        const rangeHours = rangeMs / (1000 * 60 * 60);
        
        if (rangeHours < 24) {
          return 5 * 60 * 1000; // 5 minutes
        } else if (rangeHours < 7 * 24) {
          return 60 * 60 * 1000; // 1 hour
        } else {
          return 24 * 60 * 60 * 1000; // 1 day
        }
      }

      function formatTimeBucketLabel(key, interval) {
        const date = new Date(key);
        if (interval <= 5 * 60 * 1000) {
          return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } else if (interval <= 60 * 60 * 1000) {
          return date.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit' });
        } else {
          return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
        }
      }

      let timeStart, timeEnd;
      if (filters.from && filters.to) {
        timeStart = new Date(filters.from);
        timeEnd = new Date(filters.to);
      } else if (data.length > 0) {
        const timestamps = data.map(d => new Date(d.requestedAt).getTime()).filter(t => !Number.isNaN(t));
        if (timestamps.length > 0) {
          timeStart = new Date(Math.min(...timestamps));
          timeEnd = new Date(Math.max(...timestamps));
        } else {
          timeStart = new Date(Date.now() - 24 * 60 * 60 * 1000);
          timeEnd = new Date();
        }
      } else {
        timeStart = new Date(Date.now() - 24 * 60 * 60 * 1000);
        timeEnd = new Date();
      }
      const bucketInterval = getTimeBucketInterval(timeStart, timeEnd);

      const timeBuckets = new Map();
      const cacheBuckets = new Map();
      const sortedData = [...data].sort((a, b) => new Date(a.requestedAt).getTime() - new Date(b.requestedAt).getTime());

      sortedData.forEach((d) => {
        const timestamp = new Date(d.requestedAt).getTime();
        const bucketKey = Math.floor(timestamp / bucketInterval) * bucketInterval;
        if (!timeBuckets.has(bucketKey)) {
          timeBuckets.set(bucketKey, 0);
        }
        timeBuckets.set(bucketKey, timeBuckets.get(bucketKey) + 1);

        if (!cacheBuckets.has(bucketKey)) {
          cacheBuckets.set(bucketKey, { hits: 0, total: 0 });
        }
        const bucket = cacheBuckets.get(bucketKey);
        bucket.total++;
        if (d.cacheHit) bucket.hits++;
      });

      const requestsOverTimeLabels = Array.from(timeBuckets.keys())
        .sort((a, b) => a - b)
        .map((key) => formatTimeBucketLabel(key, bucketInterval));
      const requestsOverTimeData = Array.from(timeBuckets.keys())
        .sort((a, b) => a - b)
        .map((key) => timeBuckets.get(key));

      const requestsOverTimeChartConfig = {
        type: 'line',
        data: {
          labels: requestsOverTimeLabels,
          datasets: [{
            label: 'Requests',
            data: requestsOverTimeData,
            borderColor: '#10b981',
            backgroundColor: 'rgba(16, 185, 129, 0.2)',
            tension: 0.35,
            fill: true,
            pointRadius: 0,
            pointHitRadius: 6,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            y: {
              ticks: { color: '#94a3b8', precision: 0 },
              grid: { color: '#1f2937' },
              beginAtZero: true,
            },
            x: {
              ticks: { color: '#94a3b8', maxRotation: 45, minRotation: 0 },
              grid: { display: false },
            },
          },
          plugins: { legend: { display: false } },
        },
      };
      const requestsOverTimeChartEl = document.getElementById('requestsOverTimeChart');
      chartConfigs.set('requestsOverTimeChart', safeCloneConfig(requestsOverTimeChartConfig));
      charts.push(new Chart(requestsOverTimeChartEl, requestsOverTimeChartConfig));

      // 7. Cache Hit Rate Over Time
      const cacheOverTimeLabels = Array.from(cacheBuckets.keys())
        .sort((a, b) => a - b)
        .map((key) => formatTimeBucketLabel(key, bucketInterval));
      const cacheOverTimeData = Array.from(cacheBuckets.keys())
        .sort((a, b) => a - b)
        .map((key) => {
          const bucket = cacheBuckets.get(key);
          return bucket.total > 0 ? (bucket.hits / bucket.total) * 100 : 0;
        });

      const cacheOverTimeChartConfig = {
        type: 'line',
        data: {
          labels: cacheOverTimeLabels,
          datasets: [{
            label: 'Cache Hit Rate (%)',
            data: cacheOverTimeData,
            borderColor: '#3b82f6',
            backgroundColor: 'rgba(59, 130, 246, 0.2)',
            tension: 0.35,
            fill: true,
            pointRadius: 0,
            pointHitRadius: 6,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            y: {
              ticks: { color: '#94a3b8', callback: (value) => value + '%' },
              grid: { color: '#1f2937' },
              beginAtZero: true,
              max: 100,
            },
            x: {
              ticks: { color: '#94a3b8', maxRotation: 45, minRotation: 0 },
              grid: { display: false },
            },
          },
          plugins: { legend: { display: false } },
        },
      };
      const cacheOverTimeChartEl = document.getElementById('cacheOverTimeChart');
      chartConfigs.set('cacheOverTimeChart', safeCloneConfig(cacheOverTimeChartConfig));
      charts.push(new Chart(cacheOverTimeChartEl, cacheOverTimeChartConfig));

      // 8. Latency Distribution
      const latencyBins = {
        '0-50ms': 0,
        '50-100ms': 0,
        '100-200ms': 0,
        '200-500ms': 0,
        '500-1000ms': 0,
        '1000ms+': 0,
      };

      latencyValues.forEach((latency) => {
        if (latency <= 50) latencyBins['0-50ms']++;
        else if (latency <= 100) latencyBins['50-100ms']++;
        else if (latency <= 200) latencyBins['100-200ms']++;
        else if (latency <= 500) latencyBins['200-500ms']++;
        else if (latency <= 1000) latencyBins['500-1000ms']++;
        else latencyBins['1000ms+']++;
      });

      const latencyDistributionChartConfig = {
        type: 'bar',
        data: {
          labels: Object.keys(latencyBins),
          datasets: [{
            label: 'Count',
            data: Object.values(latencyBins),
            backgroundColor: '#f59e0b',
            borderRadius: 4,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            y: {
              ticks: { color: '#94a3b8', precision: 0 },
              grid: { color: '#334155' },
              beginAtZero: true,
            },
            x: {
              ticks: { color: '#94a3b8' },
              grid: { display: false },
            },
          },
          plugins: { legend: { display: false } },
        },
      };
      const latencyDistributionChartEl = document.getElementById('latencyDistributionChart');
      chartConfigs.set('latencyDistributionChart', safeCloneConfig(latencyDistributionChartConfig));
      charts.push(new Chart(latencyDistributionChartEl, latencyDistributionChartConfig));

      // 9. Top Players
      const topPlayersLabels = topPlayers.slice(0, 20).map((p) => {
        return p.resolvedUsername || p.identifier;
      });
      const topPlayersData = topPlayers.slice(0, 20).map((p) => p.queryCount);

      const topPlayersChartConfig = {
        type: 'bar',
        data: {
          labels: topPlayersLabels,
          datasets: [{
            label: 'Query Count',
            data: topPlayersData,
            backgroundColor: '#06b6d4',
            borderRadius: 4,
          }],
        },
        options: {
          indexAxis: 'y',
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            x: {
              ticks: { color: '#94a3b8', precision: 0 },
              grid: { color: '#334155' },
              beginAtZero: true,
            },
            y: {
              ticks: { color: '#94a3b8' },
              grid: { display: false },
            },
          },
          plugins: { legend: { display: false } },
        },
      };
      const topPlayersChartEl = document.getElementById('topPlayersChart');
      chartConfigs.set('topPlayersChart', safeCloneConfig(topPlayersChartConfig));
      charts.push(new Chart(topPlayersChartEl, topPlayersChartConfig));

      applyChartHeight(currentChartHeight);

      // Fullscreen chart functionality
      const fullscreenOverlay = document.getElementById('fullscreenOverlay');
      const fullscreenCloseBtn = document.getElementById('fullscreenCloseBtn');
      const fullscreenChartTitle = document.getElementById('fullscreenChartTitle');
      const fullscreenChartCanvas = document.getElementById('fullscreenChart');
      let fullscreenChartInstance = null;

      function openFullscreenChart(chartId, chartTitle) {
        const originalChart = charts.find((chart) => chart.canvas.id === chartId);
        if (!originalChart || !fullscreenOverlay || !fullscreenChartCanvas) return;

        // Get stored config for this chart
        const storedConfig = chartConfigs.get(chartId);
        if (!storedConfig) {
          console.warn('No stored config found for chart:', chartId);
          return;
        }

        // Set title
        if (fullscreenChartTitle) {
          fullscreenChartTitle.textContent = chartTitle;
        }

        // Show overlay
        fullscreenOverlay.classList.add('active');

        // Check for existing chart on canvas and destroy it
        const existingChart = Chart.getChart(fullscreenChartCanvas);
        if (existingChart) {
          existingChart.destroy();
        }

        // Destroy existing fullscreen chart instance if any
        if (fullscreenChartInstance) {
          fullscreenChartInstance.destroy();
          fullscreenChartInstance = null;
        }

        // Build a completely fresh config - use JSON to strip all non-serializable properties
        const freshData = JSON.parse(JSON.stringify({
          labels: originalChart.data.labels || [],
          datasets: originalChart.data.datasets.map((ds) => ({
            label: ds.label,
            data: ds.data,
            backgroundColor: ds.backgroundColor,
            borderColor: ds.borderColor,
            borderWidth: ds.borderWidth,
            borderRadius: ds.borderRadius,
            tension: ds.tension,
            fill: ds.fill,
            spanGaps: ds.spanGaps,
            pointRadius: ds.pointRadius,
            pointHitRadius: ds.pointHitRadius,
          })),
        }));

        // Build fresh options from stored config (these are clean)
        const freshOptions = JSON.parse(JSON.stringify(storedConfig.options || {}));
        freshOptions.responsive = true;
        freshOptions.maintainAspectRatio = false;

        const chartConfig = {
          type: storedConfig.type,
          data: freshData,
          options: freshOptions,
        };

        // Create new chart in fullscreen
        fullscreenChartInstance = new Chart(fullscreenChartCanvas, chartConfig);
        
        // Resize to fill container
        setTimeout(() => {
          if (fullscreenChartInstance) {
            fullscreenChartInstance.resize();
          }
        }, 100);
      }

      function closeFullscreenChart() {
        if (fullscreenOverlay) {
          fullscreenOverlay.classList.remove('active');
        }
        if (fullscreenChartInstance) {
          fullscreenChartInstance.destroy();
          fullscreenChartInstance = null;
        }
      }

      // Expand button handlers
      document.querySelectorAll('.expand-btn').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const chartId = btn.getAttribute('data-chart-id');
          const chartTitle = btn.getAttribute('data-chart-title') || 'Chart';
          openFullscreenChart(chartId, chartTitle);
        });
      });

      // Close button handler
      if (fullscreenCloseBtn) {
        fullscreenCloseBtn.addEventListener('click', closeFullscreenChart);
      }

      // ESC key handler
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && fullscreenOverlay?.classList.contains('active')) {
          closeFullscreenChart();
        }
      });

      // Click outside to close
      if (fullscreenOverlay) {
        fullscreenOverlay.addEventListener('click', (e) => {
          if (e.target === fullscreenOverlay) {
            closeFullscreenChart();
          }
        });
      }
    </script>
  </body>
</html>`;

    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (error) {
    next(error);
  }
});

export default router;
