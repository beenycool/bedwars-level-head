import { Router } from 'express';
import { getPlayerQueryCount, getPlayerQueryPage } from '../services/history';
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

    // Serialise the current page data to JSON so the frontend script can use it
    // Securely escape < characters to prevent XSS via script injection
    const jsonForFrontend = JSON.stringify(pageData.rows).replace(/</g, '\\\\u003c');

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
    <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.3/dist/chart.umd.js" integrity="sha384-22kHZA1dYqStO89cK3yY9s6bF585h5c2Xg3LwH1T2iOz2L4i/l7SgA2fVdrS2Xg/" crossorigin="anonymous"></script>
    <style>
      :root {
        color-scheme: dark;
        font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: #0f172a;
        color: #e2e8f0;
      }
      body {
        padding: 2rem;
        max-width: 1200px;
        margin: 0 auto;
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

      /* NEW CSS FOR GRAPHS */
      .dashboard-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
        gap: 1.5rem;
        margin-bottom: 2rem;
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

    <div class="dashboard-grid">
        <div class="card">
            <h2>Cache Performance (Current Page)</h2>
            <canvas id="cacheChart"></canvas>
        </div>
        <div class="card">
            <h2>Star Distribution (Current Page)</h2>
            <canvas id="starChart"></canvas>
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

      // 1. Prepare Cache Data
      const cacheHits = data.filter(d => d.cacheHit).length;
      const cacheMisses = data.length - cacheHits;

      // 2. Prepare Star Data (Group by range)
      // Added 'Unknown' category for null values
      const starRanges = { 'Unknown': 0, '0-10': 0, '11-50': 0, '51-100': 0, '100+': 0 };

      data.forEach(d => {
        // Strict check: if it's null, undefined, or negative, count as Unknown
        if (d.stars === null || d.stars === undefined || d.stars < 0) {
            starRanges['Unknown']++;
            return;
        }

        const s = d.stars;
        if(s <= 10) starRanges['0-10']++;
        else if(s <= 50) starRanges['11-50']++;
        else if(s <= 100) starRanges['51-100']++;
        else starRanges['100+']++;
      });

      // Render Pie Chart (Cache)
      new Chart(document.getElementById('cacheChart'), {
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
            plugins: {
                legend: { position: 'bottom', labels: { color: '#cbd5f5' } },
                title: { display: false }
            }
        }
      });

      // Render Bar Chart (Stars)
      new Chart(document.getElementById('starChart'), {
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
      });
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
