import { Router } from 'express';
import { getPlayerQueryCount, getPlayerQueryPage, getRecentPlayerQueries } from '../services/history';
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

    const totalCount = await getPlayerQueryCount({ search });
    const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
    const page = Math.min(safePage, totalPages);
    const pageData = await getPlayerQueryPage({ page, pageSize: PAGE_SIZE, search, totalCountOverride: totalCount });
    const recentActivity = await getRecentPlayerQueries(200);

    // Serialise the recent activity so the frontend script can use it
    // Securely escape < characters to prevent XSS via script injection
    const jsonForFrontend = JSON.stringify(recentActivity).replace(/</g, '\\\\u003c');

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
    </style>
  </head>
  <body>
    <h1>Levelhead Analytics</h1>
    <p class="meta hero">Live snapshot of recent BedWars lookups (rendered locally, no external dashboards).</p>

    <div class="stat-grid">
      <div class="card stat-card">
        <p class="stat-label">Total Lookups</p>
        <p class="stat-value" id="totalLookupsValue">--</p>
        <p class="stat-sub">Last 200 lookups</p>
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
        <p class="stat-label">Latency (p95)</p>
        <p class="stat-value" id="latencyP95Value">--</p>
        <p class="stat-sub">Derived from real latency samples</p>
      </div>
    </div>

    <div class="chart-toolbar">
      <label for="chartHeightRange">Chart height</label>
      <input id="chartHeightRange" type="range" min="200" max="500" value="320" step="20" />
      <span id="chartHeightValue">320px</span>
    </div>

    <div class="dashboard-grid">
      <div class="card">
        <h2>Cache Performance (Recent Activity)</h2>
        <div class="chart-shell"><canvas id="cacheChart"></canvas></div>
      </div>
      <div class="card">
        <h2>Star Distribution (Recent Activity)</h2>
        <div class="chart-shell"><canvas id="starChart"></canvas></div>
      </div>
      <div class="card">
        <h2>Latency Pulse</h2>
        <div class="chart-shell"><canvas id="latencyChart"></canvas></div>
      </div>
      <div class="card">
        <h2>Status Breakdown</h2>
        <div class="chart-shell"><canvas id="statusChart"></canvas></div>
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
      const data = ${jsonForFrontend};
      const charts = [];

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
      const latencyP95 = percentile(latencyValues, 95);
      const latencyAvg = latencyValues.length
        ? latencyValues.reduce((sum, value) => sum + (value ?? 0), 0) / latencyValues.length
        : null;

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
      const latencySeries = sortedByRequestTime.map((d) => ({
        x: new Date(d.requestedAt),
        y: typeof d.latencyMs === 'number' && d.latencyMs >= 0 ? d.latencyMs : null,
      }));

      function setMetric(id, value) {
        const el = document.getElementById(id);
        if (el) el.textContent = value;
      }

      function setProgress(id, percentage) {
        const el = document.getElementById(id);
        if (el) el.style.width = Math.max(0, Math.min(100, percentage)) + '%';
      }

      setMetric('totalLookupsValue', totalLookups.toLocaleString());
      setMetric('cacheHitRateValue', cacheHitRate.toFixed(1) + '%');
      setProgress('cacheHitProgress', cacheHitRate);
      setMetric('successRateValue', successRate.toFixed(1) + '%');
      setProgress('successRateProgress', successRate);
      const latencyDisplay = latencyP95 ?? latencyAvg;
      setMetric(
        'latencyP95Value',
        latencyDisplay === null ? '--' : Math.round(latencyDisplay).toLocaleString() + ' ms',
      );

      // Render Pie Chart (Cache)
      charts.push(new Chart(document.getElementById('cacheChart'), {
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
                legend: { position: 'bottom', labels: { color: '#cbd5f5' } },
                title: { display: false }
            }
        }
      }));

      // Render Bar Chart (Stars)
      charts.push(new Chart(document.getElementById('starChart'), {
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
      }));

      const latencyLabels = sortedByRequestTime.map((d, index) => {
        const asDate = new Date(d.requestedAt);
        if (Number.isNaN(asDate.getTime())) return 'Lookup ' + (index + 1);
        return asDate.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
      });

      charts.push(new Chart(document.getElementById('latencyChart'), {
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
      }));

      charts.push(new Chart(document.getElementById('statusChart'), {
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
            legend: { position: 'bottom', labels: { color: '#cbd5f5' } },
            title: { display: false },
          },
        },
      }));

      applyChartHeight(currentChartHeight);
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
