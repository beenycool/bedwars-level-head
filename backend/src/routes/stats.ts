import { Router } from 'express';
import {
  getPlayerQueryCount,
  getPlayerQueryPage,
  getPlayerQueriesWithFilters,
  getTopPlayersByQueryCount,
  getSystemStats,
} from '../services/history';
import { getRedisStats } from '../services/redis';
import { escapeHtml } from '../util/html';
import { toCSV } from '../util/csv';

const router = Router();
const PAGE_SIZE = 25;

function formatDate(date: Date): string {
  return date.toISOString();
}

function timeAgo(date: Date): string {
  const seconds = Math.floor((new Date().getTime() - date.getTime()) / 1000);
  if (seconds < 5) return "just now"; // Tighter threshold

  const intervals = [
    { label: 'year', seconds: 31536000 },
    { label: 'month', seconds: 2592000 },
    { label: 'week', seconds: 604800 }, // Added week
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

router.get('/csv', async (req, res) => {
  try {
    const fromParam = typeof req.query.from === 'string' ? req.query.from : undefined;
    const toParam = typeof req.query.to === 'string' ? req.query.to : undefined;
    const limitParam = typeof req.query.limit === 'string' ? req.query.limit : undefined;

    const startDate = fromParam ? new Date(fromParam) : undefined;
    const endDate = toParam ? new Date(toParam) : undefined;
    const limit = limitParam ? Number.parseInt(limitParam, 10) : undefined;

    const validStartDate = startDate && !Number.isNaN(startDate.getTime()) ? startDate : undefined;
    const validEndDate = endDate && !Number.isNaN(endDate.getTime()) ? endDate : undefined;
    const MAX_ALLOWED_LIMIT = 10000;
    const DEFAULT_CHART_LIMIT = 200;
    const validLimit = limit !== undefined && Number.isFinite(limit)
      ? Math.min(Math.max(limit, 1), MAX_ALLOWED_LIMIT)
      : undefined;

    const hasTimeFilter = Boolean(validStartDate || validEndDate);
    const effectiveLimit = validLimit ?? (hasTimeFilter ? MAX_ALLOWED_LIMIT : DEFAULT_CHART_LIMIT);

    const data = await getPlayerQueriesWithFilters({
      startDate: validStartDate,
      endDate: validEndDate,
      limit: effectiveLimit,
    });

    const csv = toCSV(data);

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="stats.csv"');
    res.send(csv);
  } catch (error) {
    console.error('Failed to generate CSV', error);
    res.status(500).send('Internal Server Error');
  }
});

router.get('/data', async (req, res, next) => {
  try {
    const fromParam = typeof req.query.from === 'string' ? req.query.from : undefined;
    const toParam = typeof req.query.to === 'string' ? req.query.to : undefined;
    const limitParam = typeof req.query.limit === 'string' ? req.query.limit : undefined;

    const startDate = fromParam ? new Date(fromParam) : undefined;
    const endDate = toParam ? new Date(toParam) : undefined;
    const limit = limitParam ? Number.parseInt(limitParam, 10) : undefined;

    const validStartDate = startDate && !Number.isNaN(startDate.getTime()) ? startDate : undefined;
    const validEndDate = endDate && !Number.isNaN(endDate.getTime()) ? endDate : undefined;
    const MAX_ALLOWED_LIMIT = 10000;
    const DEFAULT_CHART_LIMIT = 200;
    const validLimit = limit !== undefined && Number.isFinite(limit)
      ? Math.min(Math.max(limit, 1), MAX_ALLOWED_LIMIT)
      : undefined;

    const hasTimeFilter = Boolean(validStartDate || validEndDate);
    const effectiveLimit = validLimit ?? (hasTimeFilter ? MAX_ALLOWED_LIMIT : DEFAULT_CHART_LIMIT);

    // Additional data for table update (dashboard is usually page 1)
    const search = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const page = 1;

    // Fetch all data in parallel
    const [chartData, topPlayers, sysStats, redisStats, pageData, totalCount] = await Promise.all([
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
      getSystemStats(),
      getRedisStats(),
      getPlayerQueryPage({ page, pageSize: PAGE_SIZE, search }),
      getPlayerQueryCount({ search }),
    ]);

    res.json({
      chartData,
      topPlayers,
      sysStats,
      redisStats,
      pageData: { ...pageData, totalCount }, // Include total count for pagination context if needed
      filters: {
        from: validStartDate?.toISOString(),
        to: validEndDate?.toISOString(),
        limit: validLimit,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    next(error);
  }
});

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
    const [chartData, topPlayers, sysStats, redisStats] = await Promise.all([
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
      getSystemStats(),
      getRedisStats(),
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

    const quotaPct = Math.max(0, Math.min(100, (sysStats.apiCallsLastHour / (120 * 60)) * 100));

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
          <td><a href="${lookupLink}" target="_blank" rel="noopener noreferrer" class="lookup-link">${escapeHtml(lookup)}</a></td>
          <td>${escapeHtml(resolved)}</td>
          <td class="stars">${escapeHtml(formatStars(entry.stars))}</td>
          <td>${escapeHtml(cacheSource)}${entry.revalidated ? ' <span class="tag">revalidated</span>' : ''}</td>
          <td>${entry.responseStatus}</td>
          <td class="latency">${escapeHtml(formatLatency(entry.latencyMs))}</td>
        </tr>`;
      })
      .join('\n');


    const dynamicStyles = `
      #quotaBar { width: ${quotaPct}%; }
      #redisMemBar {
        width: ${redisStats.memoryPercent.toFixed(1)}%;
        background: ${redisStats.memoryPercent > 80 ? 'linear-gradient(90deg, #f87171, #ef4444)' : 'linear-gradient(90deg, #22d3ee, #3b82f6)'};
      }
      #localCacheBar { width: ${((redisStats.localCacheSize / redisStats.localCacheMaxSize) * 100).toFixed(1)}%; }
    `;
    const html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Levelhead Player Stats</title>
    <link rel="icon" href="data:," />
    <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.3/dist/chart.umd.js" integrity="sha384-tgbB5AKnszdcfwcZtTfuhR3Ko1XZdlDfsLtkxiiAZiVkkXCkFmp+FQFh+V/UTo54" crossorigin="anonymous"></script>
    <style nonce="${res.locals.nonce}">
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
      .refresh-controls {
        display: flex;
        align-items: center;
        gap: 1rem;
        margin-top: 1rem;
        padding-top: 1rem;
        border-top: 1px solid rgba(148, 163, 184, 0.2);
        flex-wrap: wrap;
      }
      .refresh-controls label {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        color: #cbd5f5;
        font-size: 0.9rem;
        font-weight: 600;
        cursor: pointer;
      }
      .refresh-controls select {
        padding: 0.4rem 0.6rem;
        border-radius: 8px;
        border: 1px solid rgba(148, 163, 184, 0.3);
        background: rgba(15, 23, 42, 0.8);
        color: #e2e8f0;
        font-size: 0.9rem;
      }
      .refresh-controls .muted {
        margin-left: auto;
        font-variant-numeric: tabular-nums;
        color: #94a3b8;
        font-size: 0.85rem;
      }
      .refresh-btn {
        padding: 0.4rem 0.8rem;
        border-radius: 8px;
        border: 1px solid rgba(148, 163, 184, 0.35);
        background: rgba(16, 185, 129, 0.15);
        color: #6ee7b7;
        font-weight: 600;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 0.4rem;
        font-size: 0.9rem;
        transition: background 0.2s;
      }
      .refresh-btn:hover {
        background: rgba(16, 185, 129, 0.25);
      }
      .refresh-btn svg {
         width: 14px;
         height: 14px;
         fill: currentColor;
      }
      .refresh-btn.loading svg {
        animation: spin 1s linear infinite;
      }
      @keyframes spin { 100% { transform: rotate(360deg); } }

      .card {
        position: relative;
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
      .card-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 0.5rem;
      }
      .card-header h2 {
        margin: 0;
      }
      .expand-btn {
        background: rgba(59, 130, 246, 0.2);
        border: 1px solid rgba(148, 163, 184, 0.3);
        border-radius: 6px;
        padding: 0.35rem 0.5rem;
        color: #cbd5f5;
        cursor: pointer;
        font-size: 0.85rem;
        transition: background 0.2s, transform 0.2s;
        display: flex;
        align-items: center;
        gap: 0.25rem;
      }
      .expand-btn:hover {
        background: rgba(59, 130, 246, 0.4);
        transform: scale(1.05);
      }
      .expand-btn:focus-visible,
      .refresh-btn:focus-visible,
      .preset-btn:focus-visible,
      .apply-btn:focus-visible,
      .reset-btn:focus-visible,
      .search-box button:focus-visible,
      .pager button:focus-visible {
        outline: 2px solid #38bdf8;
        outline-offset: 2px;
      }

      .fullscreen-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(15, 23, 42, 0.95);
        z-index: 1000;
        display: flex;
        align-items: center;
        justify-content: center;
        animation: fadeIn 0.2s ease;
      }
      @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      .fullscreen-modal {
        width: 90vw;
        height: 85vh;
        background: rgba(30, 41, 59, 0.98);
        border: 1px solid rgba(148, 163, 184, 0.2);
        border-radius: 16px;
        padding: 1.5rem;
        display: flex;
        flex-direction: column;
        box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
      }
      .fullscreen-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 1rem;
        padding-bottom: 1rem;
        border-bottom: 1px solid rgba(148, 163, 184, 0.2);
      }
      .fullscreen-title {
        font-size: 1.35rem;
        color: #e2e8f0;
        margin: 0;
        font-weight: 600;
      }
      .fullscreen-close-btn {
        background: rgba(239, 68, 68, 0.2);
        border: 1px solid rgba(239, 68, 68, 0.4);
        border-radius: 8px;
        padding: 0.5rem 1rem;
        color: #fca5a5;
        cursor: pointer;
        font-weight: 600;
        transition: background 0.2s;
      }
      .fullscreen-close-btn:hover {
        background: rgba(239, 68, 68, 0.4);
      }
      .fullscreen-chart-container {
        flex: 1;
        position: relative;
        min-height: 0;
      }
      .fullscreen-chart-container canvas {
        width: 100% !important;
        height: 100% !important;
      }

      .refresh-countdown { min-width: 120px; text-align: right; }
      .status-connected { color: #22c55e; }
      .status-disconnected { color: #ef4444; }
      .flex-gap-05 { display: flex; gap: 0.5rem; }
      .hidden { display: none !important; }
      .overflow-hidden { overflow: hidden; }
      .btn-download {
        text-decoration: none;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(59, 130, 246, 0.2);
        border-color: rgba(59, 130, 246, 0.4);
        color: #93c5fd;
      }
      ${dynamicStyles}
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
      
      <div class="refresh-controls">
        <label>
          <input type="checkbox" id="autoRefreshToggle" />
          Auto-refresh every
        </label>
        <select id="refreshInterval" aria-label="Refresh interval">
          <option value="10000">10s</option>
          <option value="30000" selected>30s</option>
          <option value="60000">1m</option>
          <option value="300000">5m</option>
        </select>
        
        <span id="refreshCountdown" class="muted refresh-countdown"></span>
        
        <button id="refreshNowBtn" class="refresh-btn">
          <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>
          Refresh Now
        </button>
      </div>
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
        <div class="progress" role="progressbar" aria-label="Cache Hit Rate" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span id="cacheHitProgress"></span></div>
        <p class="stat-sub">Measured from recent lookups</p>
      </div>
      <div class="card stat-card">
        <p class="stat-label">Success Rate</p>
        <p class="stat-value" id="successRateValue">--</p>
        <div class="progress" role="progressbar" aria-label="Success Rate" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span id="successRateProgress"></span></div>
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

    <h2>Infrastructure Health</h2>
    <div class="stat-grid">
      <div class="card stat-card">
        <p class="stat-label">Database Size</p>
        <p class="stat-value">${escapeHtml(sysStats.dbSize)}</p>
        <p class="stat-sub">Index: ${escapeHtml(sysStats.indexSize)}</p>
      </div>
      <div class="card stat-card">
        <p class="stat-label">Hypixel API (1h)</p>
        <p class="stat-value">${escapeHtml(sysStats.apiCallsLastHour.toLocaleString())}</p>
        <div class="progress" role="progressbar" aria-label="Hypixel API Quota Usage" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(quotaPct)}">
          <span id="quotaBar"></span>
        </div>
        <p class="stat-sub">Quota usage</p>
      </div>
      <div class="card stat-card">
        <p class="stat-label">Cached Profiles</p>
        <p class="stat-value">${escapeHtml(sysStats.cacheCount.toLocaleString())}</p>
        <p class="stat-sub">Avg payload: ${escapeHtml(sysStats.avgPayloadSize)}</p>
      </div>
    </div>

    <h2>Redis Rate Limiting</h2>
    <div class="stat-grid">
      <div class="card stat-card">
        <p class="stat-label">Status</p>
        <p class="stat-value ${redisStats.connected ? 'status-connected' : 'status-disconnected'}">${redisStats.connected ? '● Connected' : '○ Disconnected'}</p>
        <p class="stat-sub">${redisStats.connected ? 'Rate limiting active' : 'Falling back to Postgres'}</p>
      </div>
      <div class="card stat-card">
        <p class="stat-label">Memory Usage</p>
        <p class="stat-value">${escapeHtml(redisStats.memoryUsed)}</p>
        <div class="progress" role="progressbar" aria-label="Redis Memory Usage" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(redisStats.memoryPercent)}">
          <span id="redisMemBar"></span>
        </div>
        <p class="stat-sub">Max: ${escapeHtml(redisStats.memoryMax)} (${redisStats.memoryPercent.toFixed(1)}%)</p>
      </div>
      <div class="card stat-card">
        <p class="stat-label">Active Rate Limit Keys</p>
        <p class="stat-value">${redisStats.rateLimitKeys.toLocaleString()}</p>
        <p class="stat-sub">Currently tracked IPs (Redis)</p>
      </div>
      <div class="card stat-card">
        <p class="stat-label">Local Memory Cache</p>
        <p class="stat-value">${redisStats.localCacheSize.toLocaleString()}</p>
        <div class="progress" role="progressbar" aria-label="Local Memory Cache Usage" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round((redisStats.localCacheSize / redisStats.localCacheMaxSize) * 100)}">
          <span id="localCacheBar"></span>
        </div>
        <p class="stat-sub">Max: ${redisStats.localCacheMaxSize.toLocaleString()} entries</p>
      </div>
      <div class="card stat-card">
        <p class="stat-label">Stats Buckets</p>
        <p class="stat-value">${redisStats.statsKeys.toLocaleString()}</p>
        <p class="stat-sub">HLL + counter keys</p>
      </div>
    </div>


    <div class="chart-toolbar">
      <label for="chartHeightRange">Chart height</label>
      <input id="chartHeightRange" type="range" min="200" max="500" value="320" step="20" />
      <span id="chartHeightValue">320px</span>
    </div>

    <div class="dashboard-grid">
      <div class="card">
        <div class="card-header">
          <h2>Cache Performance</h2>
          <button class="expand-btn" data-chart="cacheChart" title="Expand chart" aria-label="Expand Cache Performance chart">
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/>
            </svg>
          </button>
        </div>
        <div class="chart-shell"><canvas id="cacheChart" role="img" aria-label="Doughnut chart showing cache hit versus network fetch ratio"></canvas></div>
      </div>
      <div class="card">
        <div class="card-header">
          <h2>Star Distribution</h2>
          <button class="expand-btn" data-chart="starChart" title="Expand chart" aria-label="Expand Star Distribution chart">
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/>
            </svg>
          </button>
        </div>
        <div class="chart-shell"><canvas id="starChart" role="img" aria-label="Bar chart showing player distribution by BedWars star ranges"></canvas></div>
      </div>
      <div class="card">
        <div class="card-header">
          <h2>Latency Pulse</h2>
          <button class="expand-btn" data-chart="latencyChart" title="Expand chart" aria-label="Expand Latency Pulse chart">
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/>
            </svg>
          </button>
        </div>
        <div class="latency-chart-controls">
          <label>
            <input type="checkbox" id="includeCacheHits" checked />
            Include cache hits
          </label>
        </div>
        <div class="chart-shell"><canvas id="latencyChart" role="img" aria-label="Line chart showing request latency trends over time"></canvas></div>
      </div>
      <div class="card">
        <div class="card-header">
          <h2>Status Breakdown</h2>
          <button class="expand-btn" data-chart="statusChart" title="Expand chart" aria-label="Expand Status Breakdown chart">
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/>
            </svg>
          </button>
        </div>
        <div class="chart-shell"><canvas id="statusChart" role="img" aria-label="Doughnut chart showing breakdown of HTTP response status codes"></canvas></div>
      </div>
      <div class="card">
        <div class="card-header">
          <h2>Lookup Type Distribution</h2>
          <button class="expand-btn" data-chart="lookupTypeChart" title="Expand chart" aria-label="Expand Lookup Type Distribution chart">
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/>
            </svg>
          </button>
        </div>
        <div class="chart-shell"><canvas id="lookupTypeChart" role="img" aria-label="Doughnut chart showing distribution of UUID versus username lookups"></canvas></div>
      </div>
      <div class="card">
        <div class="card-header">
          <h2>Requests Over Time</h2>
          <button class="expand-btn" data-chart="requestsOverTimeChart" title="Expand chart" aria-label="Expand Requests Over Time chart">
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/>
            </svg>
          </button>
        </div>
        <div class="chart-shell"><canvas id="requestsOverTimeChart" role="img" aria-label="Line chart showing total requests over time"></canvas></div>
      </div>
      <div class="card">
        <div class="card-header">
          <h2>Cache Hit Rate Over Time</h2>
          <button class="expand-btn" data-chart="cacheOverTimeChart" title="Expand chart" aria-label="Expand Cache Hit Rate Over Time chart">
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/>
            </svg>
          </button>
        </div>
        <div class="chart-shell"><canvas id="cacheOverTimeChart" role="img" aria-label="Line chart showing cache hit rate percentage over time"></canvas></div>
      </div>
      <div class="card">
        <div class="card-header">
          <h2>Latency Distribution</h2>
          <button class="expand-btn" data-chart="latencyDistributionChart" title="Expand chart" aria-label="Expand Latency Distribution chart">
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/>
            </svg>
          </button>
        </div>
        <div class="chart-shell"><canvas id="latencyDistributionChart" role="img" aria-label="Bar chart showing distribution of request latency in milliseconds"></canvas></div>
      </div>
      <div class="card">
        <div class="card-header">
          <h2>Top Queried Players</h2>
          <button class="expand-btn" data-chart="topPlayersChart" title="Expand chart" aria-label="Expand Top Queried Players chart">
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/>
            </svg>
          </button>
        </div>
        <div class="chart-shell"><canvas id="topPlayersChart" role="img" aria-label="Bar chart showing top 20 most queried players"></canvas></div>
      </div>
    </div>

    <div id="fullscreenOverlay" class="fullscreen-overlay hidden">
      <div class="fullscreen-modal">
        <div class="fullscreen-header">
          <h3 class="fullscreen-title" id="fullscreenTitle"></h3>
          <div class="flex-gap-05">
            <a id="fullscreenDownloadBtn" class="fullscreen-close-btn btn-download" href="#" target="_blank">Download CSV</a>
            <button class="fullscreen-close-btn" id="fullscreenCloseBtn">✕ Close</button>
          </div>
        </div>
        <div class="fullscreen-chart-container">
          <canvas id="fullscreenChart" role="img" aria-label=""></canvas>
        </div>
      </div>
    </div>



    <h2>Recent Player Lookups</h2>
    <p class="meta">${pageData.totalCount === 0 ? 'No lookups recorded yet.' : `Showing page ${page} of ${totalPages} (${pageData.totalCount} total lookups).`}</p>
    <div class="controls">
      <form class="search-box" method="GET">
        <input
          type="search"
          name="q"
          id="searchInput"
          aria-label="Search players"
          placeholder="Search by username or UUID (Press /)"
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
          <th scope="col">Queried At</th>
          <th scope="col">Lookup</th>
          <th scope="col">Resolved</th>
          <th scope="col">Stars</th>
          <th scope="col">Source</th>
          <th scope="col">Status</th>
          <th scope="col">Latency</th>
        </tr>
      </thead>
      <tbody>
        ${rows || '<tr><td colspan="7">No lookups recorded yet.</td></tr>'}
      </tbody>
    </table>

    <script nonce="${res.locals.nonce}">
      const nonce = "${res.locals.nonce}";
      const pageData = ${jsonForFrontend};
      const data = pageData.chartData || [];
      const topPlayers = pageData.topPlayers || [];
      const filters = pageData.filters || {};

      // Keyboard shortcut for search
      document.addEventListener('keydown', (e) => {
        const activeElement = document.activeElement;
        if (
          e.key === '/'
          && !['INPUT', 'TEXTAREA', 'SELECT'].includes(activeElement?.tagName)
          && activeElement?.isContentEditable !== true
        ) {
          e.preventDefault();
          const searchInput = document.getElementById('searchInput');
          if (searchInput) {
            searchInput.focus();
            searchInput.select();
          }
        }
      });

      const charts = [];
      // Store original chart configs for fullscreen cloning (avoids Chart.js resolver issues)


      // Safe deep clone helper that preserves functions but skips Chart.js internal properties


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
        let rootStyle = document.getElementById('root-style');
        if (!rootStyle) {
           rootStyle = document.createElement('style');
           rootStyle.id = 'root-style';
           rootStyle.setAttribute('nonce', nonce);
           document.head.appendChild(rootStyle);
        }
        rootStyle.textContent = ':root { --chart-height: ' + clamped + 'px; }';
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
        let styleId = 'style-' + id;
        let styleEl = document.getElementById(styleId);
        if (!styleEl) {
          styleEl = document.createElement('style');
          styleEl.id = styleId;
          styleEl.setAttribute('nonce', nonce);
          document.head.appendChild(styleEl);
        }
        styleEl.textContent = '#' + id + ' { width: ' + Math.max(0, Math.min(100, percentage)) + '% !important; };';

        const barSpan = document.getElementById(id);
        if (barSpan && barSpan.parentElement && barSpan.parentElement.getAttribute('role') === 'progressbar') {
          barSpan.parentElement.setAttribute('aria-valuenow', Math.round(percentage));
        }
      }

      const chartAriaBase = {
        cacheChart: 'Doughnut chart showing cache hit versus network fetch ratio',
        starChart: 'Bar chart showing player distribution by BedWars star ranges',
        latencyChart: 'Line chart showing request latency trends over time',
        statusChart: 'Doughnut chart showing breakdown of HTTP response status codes',
        lookupTypeChart: 'Doughnut chart showing distribution of UUID versus username lookups',
        requestsOverTimeChart: 'Line chart showing total requests over time',
        cacheOverTimeChart: 'Line chart showing cache hit rate percentage over time',
        latencyDistributionChart: 'Bar chart showing distribution of request latency in milliseconds',
        topPlayersChart: 'Bar chart showing top 20 most queried players',
      };

      function setChartAriaLabel(chartId, label) {
        const canvas = document.getElementById(chartId);
        if (canvas) {
          canvas.setAttribute('aria-label', label);
        }
      }

      function buildFilterSummaryText(activeFilters) {
        if (!activeFilters) return '';
        const parts = [];
        if (activeFilters.from) parts.push('from ' + new Date(activeFilters.from).toLocaleString());
        if (activeFilters.to) parts.push('to ' + new Date(activeFilters.to).toLocaleString());
        if (activeFilters.limit) parts.push('limit ' + activeFilters.limit);
        return parts.length ? ' Filters ' + parts.join(', ') + '.' : '';
      }

      function buildLatencyAriaLabel(summary) {
        const count = Number(summary.latencySeriesCount ?? 0).toLocaleString();
        const inclusion = summary.includeCacheHits ? 'including cache hits' : 'excluding cache hits';
        return \`\${chartAriaBase.latencyChart}. \${count} data points, \${inclusion}.\${buildFilterSummaryText(summary.filters)}\`;
      }

      let latestAriaSummary = null;

      function updateChartAriaLabels(summary) {
        if (!summary) return;
        latestAriaSummary = summary;
        const filterSummary = buildFilterSummaryText(summary.filters);
        const cacheHits = Number(summary.cacheHits ?? 0);
        const cacheMisses = Number(summary.cacheMisses ?? 0);

        setChartAriaLabel(
          'cacheChart',
          \`\${chartAriaBase.cacheChart}. Cache hits: \${cacheHits.toLocaleString()}, network fetches: \${cacheMisses.toLocaleString()}.\${filterSummary}\`,
        );

        const starRanges = summary.starRanges ?? {};
        setChartAriaLabel(
          'starChart',
          \`\${chartAriaBase.starChart}. Unknown: \${Number(starRanges.Unknown ?? 0).toLocaleString()}, 0-10: \${Number(starRanges['0-10'] ?? 0).toLocaleString()}, 11-50: \${Number(starRanges['11-50'] ?? 0).toLocaleString()}, 51-100: \${Number(starRanges['51-100'] ?? 0).toLocaleString()}, 100+: \${Number(starRanges['100+'] ?? 0).toLocaleString()}.\${filterSummary}\`,
        );

        setChartAriaLabel('latencyChart', buildLatencyAriaLabel(summary));

        const statusBuckets = summary.statusBuckets ?? {};
        setChartAriaLabel(
          'statusChart',
          \`\${chartAriaBase.statusChart}. 2xx: \${Number(statusBuckets['2xx'] ?? 0).toLocaleString()}, 3xx: \${Number(statusBuckets['3xx'] ?? 0).toLocaleString()}, 4xx: \${Number(statusBuckets['4xx'] ?? 0).toLocaleString()}, 5xx: \${Number(statusBuckets['5xx'] ?? 0).toLocaleString()}, other: \${Number(statusBuckets.Other ?? 0).toLocaleString()}.\${filterSummary}\`,
        );

        const lookupTypeCounts = summary.lookupTypeCounts ?? {};
        setChartAriaLabel(
          'lookupTypeChart',
          \`\${chartAriaBase.lookupTypeChart}. UUID: \${Number(lookupTypeCounts.UUID ?? 0).toLocaleString()}, IGN: \${Number(lookupTypeCounts.IGN ?? 0).toLocaleString()}.\${filterSummary}\`,
        );

        const requestsTotal = (summary.requestsOverTimeData ?? []).reduce((acc, value) => acc + Number(value ?? 0), 0);
        setChartAriaLabel(
          'requestsOverTimeChart',
          \`\${chartAriaBase.requestsOverTimeChart}. \${requestsTotal.toLocaleString()} total requests across \${(summary.requestsOverTimeData ?? []).length.toLocaleString()} time buckets.\${filterSummary}\`,
        );

        const cacheOverTimeData = summary.cacheOverTimeData ?? [];
        const avgCacheRate = cacheOverTimeData.length
          ? cacheOverTimeData.reduce((acc, value) => acc + Number(value ?? 0), 0) / cacheOverTimeData.length
          : 0;
        setChartAriaLabel(
          'cacheOverTimeChart',
          \`\${chartAriaBase.cacheOverTimeChart}. Average cache hit rate \${avgCacheRate.toFixed(1)}% across \${cacheOverTimeData.length.toLocaleString()} time buckets.\${filterSummary}\`,
        );

        const latencyBins = summary.latencyBins ?? {};
        setChartAriaLabel(
          'latencyDistributionChart',
          \`\${chartAriaBase.latencyDistributionChart}. 0-50ms: \${Number(latencyBins['0-50ms'] ?? 0).toLocaleString()}, 50-100ms: \${Number(latencyBins['50-100ms'] ?? 0).toLocaleString()}, 100-200ms: \${Number(latencyBins['100-200ms'] ?? 0).toLocaleString()}, 200-500ms: \${Number(latencyBins['200-500ms'] ?? 0).toLocaleString()}, 500-1000ms: \${Number(latencyBins['500-1000ms'] ?? 0).toLocaleString()}, 1000ms+: \${Number(latencyBins['1000ms+'] ?? 0).toLocaleString()}.\${filterSummary}\`,
        );

        const topPlayersLabels = summary.topPlayersLabels ?? [];
        const topPlayersData = summary.topPlayersData ?? [];
        if (topPlayersLabels.length > 0) {
          setChartAriaLabel(
            'topPlayersChart',
            \`\${chartAriaBase.topPlayersChart}. Top player \${topPlayersLabels[0]} with \${Number(topPlayersData[0] ?? 0).toLocaleString()} queries.\${filterSummary}\`,
          );
        } else {
          setChartAriaLabel(
            'topPlayersChart',
            \`\${chartAriaBase.topPlayersChart}. No player data available.\${filterSummary}\`,
          );
        }
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

        if (latestAriaSummary) {
          updateChartAriaLabels({
            ...latestAriaSummary,
            latencySeriesCount: getLatencySeriesCount(),
            includeCacheHits,
          });
        }
      }

      function getLatencySeriesCount() {
        return includeCacheHits
          ? allLatencySeries.length
          : allLatencySeries.filter((point) => !point.cacheHit).length;
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

      function buildTimeBucketData(dataSet, activeFilters) {
        let timeStart, timeEnd;
        if (activeFilters?.from && activeFilters?.to) {
          timeStart = new Date(activeFilters.from);
          timeEnd = new Date(activeFilters.to);
        } else if (dataSet.length > 0) {
          const timestamps = dataSet.map(d => new Date(d.requestedAt).getTime()).filter(t => !Number.isNaN(t));
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
        const sortedData = [...dataSet].sort((a, b) => new Date(a.requestedAt).getTime() - new Date(b.requestedAt).getTime());

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

        const timeBucketKeys = Array.from(timeBuckets.keys()).sort((a, b) => a - b);
        const cacheBucketKeys = Array.from(cacheBuckets.keys()).sort((a, b) => a - b);

        const requestsOverTimeLabels = timeBucketKeys.map((key) => formatTimeBucketLabel(key, bucketInterval));
        const requestsOverTimeData = timeBucketKeys.map((key) => timeBuckets.get(key));
        const cacheOverTimeLabels = cacheBucketKeys.map((key) => formatTimeBucketLabel(key, bucketInterval));
        const cacheOverTimeData = cacheBucketKeys.map((key) => {
          const bucket = cacheBuckets.get(key);
          return bucket.total > 0 ? (bucket.hits / bucket.total) * 100 : 0;
        });

        return {
          requestsOverTimeLabels,
          requestsOverTimeData,
          cacheOverTimeLabels,
          cacheOverTimeData,
        };
      }

      const {
        requestsOverTimeLabels,
        requestsOverTimeData,
        cacheOverTimeLabels,
        cacheOverTimeData,
      } = buildTimeBucketData(data, filters);

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

      charts.push(new Chart(requestsOverTimeChartEl, requestsOverTimeChartConfig));

      // 7. Cache Hit Rate Over Time
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

      charts.push(new Chart(topPlayersChartEl, topPlayersChartConfig));

      updateChartAriaLabels({
        filters,
        cacheHits,
        cacheMisses,
        starRanges,
        statusBuckets,
        lookupTypeCounts,
        requestsOverTimeData,
        cacheOverTimeData,
        latencyBins,
        topPlayersLabels,
        topPlayersData: topPlayersData,
        latencySeriesCount: getLatencySeriesCount(),
        includeCacheHits,
      });

      applyChartHeight(currentChartHeight);

      // Fullscreen chart handling
      const chartConfigs = {
        cacheChart: { title: 'Cache Performance', config: cacheChartConfig },
        starChart: { title: 'Star Distribution', config: starChartConfig },
        latencyChart: { title: 'Latency Pulse', config: latencyChartConfig },
        statusChart: { title: 'Status Breakdown', config: statusChartConfig },
        lookupTypeChart: { title: 'Lookup Type Distribution', config: lookupTypeChartConfig },
        requestsOverTimeChart: { title: 'Requests Over Time', config: requestsOverTimeChartConfig },
        cacheOverTimeChart: { title: 'Cache Hit Rate Over Time', config: cacheOverTimeChartConfig },
        latencyDistributionChart: { title: 'Latency Distribution', config: latencyDistributionChartConfig },
        topPlayersChart: { title: 'Top Queried Players', config: topPlayersChartConfig },
      };

      let fullscreenChartInstance = null;

      function deepCloneConfig(config) {
        // Deep clone that handles data arrays properly
        const cloned = {
          type: config.type,
          data: {
            labels: config.data.labels ? [...config.data.labels] : [],
            datasets: config.data.datasets.map(ds => ({
              ...ds,
              data: Array.isArray(ds.data) ? [...ds.data] : ds.data,
              backgroundColor: Array.isArray(ds.backgroundColor) 
                ? [...ds.backgroundColor] 
                : ds.backgroundColor,
            })),
          },
          options: JSON.parse(JSON.stringify(config.options || {})),
        };
        return cloned;
      }

      function openFullscreen(chartId) {
        const overlay = document.getElementById('fullscreenOverlay');
        const titleEl = document.getElementById('fullscreenTitle');
        const downloadBtn = document.getElementById('fullscreenDownloadBtn');
        const canvas = document.getElementById('fullscreenChart');
        const info = chartConfigs[chartId];
        
        if (!info || !overlay || !canvas) return;
        
        // Clean up any existing fullscreen chart
        if (fullscreenChartInstance) {
          fullscreenChartInstance.destroy();
          fullscreenChartInstance = null;
        }
        
        titleEl.textContent = info.title;
        canvas.setAttribute('aria-label', info.title + ' (expanded view)');
        overlay.classList.remove('hidden');
        document.body.classList.add('overflow-hidden');

        if (downloadBtn) {
            const url = new URL(window.location.origin + '/stats/csv');
            if (filters.from) url.searchParams.set('from', filters.from);
            if (filters.to) url.searchParams.set('to', filters.to);
            if (filters.limit) url.searchParams.set('limit', filters.limit);
            downloadBtn.href = url.toString();
        }
        
        // Clone config to avoid mutating original
        const clonedConfig = deepCloneConfig(info.config);
        
        // Create new chart in fullscreen canvas
        fullscreenChartInstance = new Chart(canvas, clonedConfig);
      }

      function closeFullscreen() {
        const overlay = document.getElementById('fullscreenOverlay');
        if (fullscreenChartInstance) {
          fullscreenChartInstance.destroy();
          fullscreenChartInstance = null;
        }
        if (overlay) {
          overlay.classList.add('hidden');
        }
        document.body.classList.remove('overflow-hidden');
      }

      // Attach event listeners to expand buttons
      document.querySelectorAll('.expand-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const chartId = btn.getAttribute('data-chart');
          if (chartId) openFullscreen(chartId);
        });
      });

      // Close button handler
      const closeBtn = document.getElementById('fullscreenCloseBtn');
      if (closeBtn) {
        closeBtn.addEventListener('click', closeFullscreen);
      }

      // Click on overlay background to close
      const overlay = document.getElementById('fullscreenOverlay');
      if (overlay) {
        overlay.addEventListener('click', (e) => {
          if (e.target.id === 'fullscreenOverlay') {
            closeFullscreen();
          }
        });
      }

      // Escape key to close
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          closeFullscreen();
        }
      });

      // ---------------------------------------------------------
      // AUTO REFRESH LOGIC
      // ---------------------------------------------------------
      
      // Client-side helper functions for formatting (mirrors server-side)
      function escapeHtmlClient(str) {
        if (str === null || str === undefined) return '';
        return String(str)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#039;');
      }
      
      function formatDateClient(date) {
        return new Date(date).toISOString();
      }
      
      function timeAgoClient(date) {
        const dateObj = date instanceof Date ? date : new Date(date);
        const seconds = Math.floor((new Date().getTime() - dateObj.getTime()) / 1000);
        if (seconds < 5) return 'just now';
        
        const intervals = [
          { label: 'year', seconds: 31536000 },
          { label: 'month', seconds: 2592000 },
          { label: 'week', seconds: 604800 },
          { label: 'day', seconds: 86400 },
          { label: 'hour', seconds: 3600 },
          { label: 'minute', seconds: 60 }
        ];
        
        for (const interval of intervals) {
          const count = Math.floor(seconds / interval.seconds);
          if (count >= 1) {
            return \`\${count} \${interval.label}\${count !== 1 ? 's' : ''} ago\`;
          }
        }
        return \`\${Math.floor(seconds)} second\${Math.floor(seconds) !== 1 ? 's' : ''} ago\`;
      }
      
      function formatStarsClient(stars) {
        if (stars === null || stars === undefined || Number.isNaN(stars)) return '--';
        return String(stars);
      }
      
      function formatLatencyClient(latency) {
        if (latency === null || latency === undefined || Number.isNaN(latency) || latency < 0) return '--';
        return \`\${latency.toLocaleString()} ms\`;
      }
      
      let autoRefreshEnabled = false;
      let refreshIntervalMs = 30000;
      let refreshTimer = null;
      let countdownTimer = null;
      let nextRefreshTime = null;
      let isRefreshing = false;

      const autoRefreshToggle = document.getElementById('autoRefreshToggle');
      const refreshIntervalSelect = document.getElementById('refreshInterval');
      const refreshCountdownEl = document.getElementById('refreshCountdown');
      const refreshNowBtn = document.getElementById('refreshNowBtn');

      // Load preferences from localStorage
      try {
        const savedAuto = window.localStorage.getItem('autoRefreshEnabled');
        if (savedAuto === 'true') {
          autoRefreshEnabled = true;
          if (autoRefreshToggle) autoRefreshToggle.checked = true;
        }
        
        const savedInterval = window.localStorage.getItem('refreshIntervalMs');
        if (savedInterval) {
          refreshIntervalMs = parseInt(savedInterval, 10);
          if (refreshIntervalSelect) refreshIntervalSelect.value = savedInterval;
        }
      } catch (e) {
        console.warn('Failed to load refresh preferences', e);
      }

      function updateCountdown() {
        if (!autoRefreshEnabled || !nextRefreshTime) {
          if (refreshCountdownEl) refreshCountdownEl.textContent = '';
          return;
        }
        
        const now = Date.now();
        const diff = Math.max(0, nextRefreshTime - now);
        const seconds = Math.ceil(diff / 1000);
        
        if (refreshCountdownEl) {
          if (isRefreshing) {
            refreshCountdownEl.textContent = 'Refreshing...';
          } else {
            refreshCountdownEl.textContent = \`Next update in \${seconds}s\`;
          }
        }
      }

      function scheduleNextRefresh() {
        if (!autoRefreshEnabled) return;
        nextRefreshTime = Date.now() + refreshIntervalMs;
        if (refreshTimer) clearTimeout(refreshTimer);
        refreshTimer = setTimeout(fetchLatestData, refreshIntervalMs);
        
        if (countdownTimer) clearInterval(countdownTimer);
        countdownTimer = setInterval(updateCountdown, 1000);
        updateCountdown();
      }

      function stopAutoRefreshLogic() {
        if (refreshTimer) clearTimeout(refreshTimer);
        if (countdownTimer) clearInterval(countdownTimer);
        refreshTimer = null;
        countdownTimer = null;
        nextRefreshTime = null;
        updateCountdown();
      }

      async function fetchLatestData() {
        if (isRefreshing) return;
        isRefreshing = true;
        updateCountdown();
        
        if (refreshNowBtn) refreshNowBtn.classList.add('loading');
        
        try {
          // Construct URL with current filters from page URL
          const url = new URL(window.location.origin + '/stats/data');
          const currentUrl = new URL(window.location.href);
          
          if (currentUrl.searchParams.has('from')) url.searchParams.set('from', currentUrl.searchParams.get('from'));
          if (currentUrl.searchParams.has('to')) url.searchParams.set('to', currentUrl.searchParams.get('to'));
          if (currentUrl.searchParams.has('limit')) url.searchParams.set('limit', currentUrl.searchParams.get('limit'));
          if (currentUrl.searchParams.has('q')) url.searchParams.set('q', currentUrl.searchParams.get('q'));
          
          const res = await fetch(url);
          if (!res.ok) throw new Error(\`HTTP \${res.status}\`);
          
          const json = await res.json();
          updateDashboard(json);
          
        } catch (error) {
          console.error('Failed to refresh data', error);
          if (refreshCountdownEl) refreshCountdownEl.textContent = 'Update failed';
        } finally {
          isRefreshing = false;
          if (refreshNowBtn) refreshNowBtn.classList.remove('loading');
          // Schedule next refresh if still enabled
          if (autoRefreshEnabled) {
            scheduleNextRefresh();
          }
        }
      }

      function updateDashboard(json) {
        const { chartData, topPlayers, sysStats, redisStats, pageData } = json;
        const activeFilters = json.filters || filters;
        
        // Re-calculate derived metrics
        const cacheHitsCount = chartData.filter((d) => d.cacheHit).length;
        const totalReqs = chartData.length;
        const newCacheHitRate = totalReqs === 0 ? 0 : (cacheHitsCount / totalReqs) * 100;
        const succCount = chartData.filter((d) => d.responseStatus >= 200 && d.responseStatus < 400).length;
        const newSuccRate = totalReqs === 0 ? 0 : (succCount / totalReqs) * 100;
        
        const latVals = chartData
          .map((d) => (typeof d.latencyMs === 'number' && d.latencyMs >= 0 ? d.latencyMs : null))
          .filter((v) => v !== null);
        
        // Update global latencyMetrics object
        latencyMetrics.p50 = percentile(latVals, 50);
        latencyMetrics.p95 = percentile(latVals, 95);
        latencyMetrics.p99 = percentile(latVals, 99);
        latencyMetrics.min = latVals.length > 0 ? Math.min(...latVals) : null;
        latencyMetrics.max = latVals.length > 0 ? Math.max(...latVals) : null;
        latencyMetrics.avg = latVals.length
          ? latVals.reduce((sum, value) => sum + (value ?? 0), 0) / latVals.length
          : null;
        
        // Update Stat Cards
        setMetric('totalLookupsValue', totalReqs.toLocaleString());
        const totalLookupsSub = document.getElementById('totalLookupsSub');
        if (totalLookupsSub) {
          if (json.filters && json.filters.limit) {
            totalLookupsSub.textContent = \`Showing \${totalReqs.toLocaleString()} of \${json.filters.limit} limit\`;
          } else {
            totalLookupsSub.textContent = \`\${totalReqs.toLocaleString()} total lookups\`;
          }
        }
        
        setMetric('cacheHitRateValue', newCacheHitRate.toFixed(1) + '%');
        setProgress('cacheHitProgress', newCacheHitRate);
        
        setMetric('successRateValue', newSuccRate.toFixed(1) + '%');
        setProgress('successRateProgress', newSuccRate);
        
        updateLatencyDisplay(); // Refreshes the displayed latency metric based on selection
        
        // Update Charts
        // 1. Cache Chart
        const cacheChart = charts.find(c => c.canvas && c.canvas.id === 'cacheChart');
        if (cacheChart) {
          cacheChart.data.datasets[0].data = [cacheHitsCount, totalReqs - cacheHitsCount];
          cacheChart.update();
          if (chartConfigs['cacheChart']) {
            chartConfigs['cacheChart'].config.data.datasets[0].data = [cacheHitsCount, totalReqs - cacheHitsCount];
          }
        }
        
        // 2. Star Chart
        const newStarRanges = { Unknown: 0, '0-10': 0, '11-50': 0, '51-100': 0, '100+': 0 };
        chartData.forEach((d) => {
          if (d.stars === null || d.stars === undefined || d.stars < 0) {
            newStarRanges.Unknown++;
          } else {
            const s = d.stars;
            if (s <= 10) newStarRanges['0-10']++;
            else if (s <= 50) newStarRanges['11-50']++;
            else if (s <= 100) newStarRanges['51-100']++;
            else newStarRanges['100+']++;
          }
        });
        const starChart = charts.find(c => c.canvas && c.canvas.id === 'starChart');
        if (starChart) {
          starChart.data.datasets[0].data = Object.values(newStarRanges);
          starChart.update();
          if (chartConfigs['starChart']) {
            chartConfigs['starChart'].config.data.datasets[0].data = Object.values(newStarRanges);
          }
        }
        
        // 3. Latency Chart - update allLatencySeries by mutating the array
        const sorted = [...chartData].sort((a, b) => new Date(a.requestedAt).getTime() - new Date(b.requestedAt).getTime());
        const newLatencySeries = sorted.map((d) => ({
          x: new Date(d.requestedAt),
          y: typeof d.latencyMs === 'number' && d.latencyMs >= 0 ? d.latencyMs : null,
          cacheHit: d.cacheHit || false,
        }));
        
        // Mutate the const array contents
        allLatencySeries.length = 0;
        allLatencySeries.push(...newLatencySeries);
        
        // Call existing updateLatencyChart function if available
        if (typeof updateLatencyChart === 'function') {
          updateLatencyChart();
        }
        
        // 4. Status Chart
        const newStatusBuckets = { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0, Other: 0 };
        chartData.forEach((d) => {
          if (d.responseStatus >= 200 && d.responseStatus < 300) newStatusBuckets['2xx']++;
          else if (d.responseStatus >= 300 && d.responseStatus < 400) newStatusBuckets['3xx']++;
          else if (d.responseStatus >= 400 && d.responseStatus < 500) newStatusBuckets['4xx']++;
          else if (d.responseStatus >= 500 && d.responseStatus < 600) newStatusBuckets['5xx']++;
          else newStatusBuckets.Other++;
        });
        const statusChart = charts.find(c => c.canvas && c.canvas.id === 'statusChart');
        if (statusChart) {
          statusChart.data.datasets[0].data = Object.values(newStatusBuckets);
          statusChart.update();
          if (chartConfigs['statusChart']) {
            chartConfigs['statusChart'].config.data.datasets[0].data = Object.values(newStatusBuckets);
          }
        }
        
        // 5. Lookup Type Chart
        const newLookupTypeCounts = { UUID: 0, IGN: 0 };
        chartData.forEach((d) => {
          if (d.lookupType === 'uuid') {
            newLookupTypeCounts.UUID++;
          } else {
            newLookupTypeCounts.IGN++;
          }
        });
        const lookupTypeChart = charts.find(c => c.canvas && c.canvas.id === 'lookupTypeChart');
        if (lookupTypeChart) {
          lookupTypeChart.data.datasets[0].data = [newLookupTypeCounts.UUID, newLookupTypeCounts.IGN];
          lookupTypeChart.update();
          if (chartConfigs['lookupTypeChart']) {
            chartConfigs['lookupTypeChart'].config.data.datasets[0].data = [newLookupTypeCounts.UUID, newLookupTypeCounts.IGN];
          }
        }

        // 6. Requests Over Time + Cache Hit Rate Over Time
        const {
          requestsOverTimeLabels,
          requestsOverTimeData,
          cacheOverTimeLabels,
          cacheOverTimeData,
        } = buildTimeBucketData(chartData, activeFilters);

        const requestsOverTimeChart = charts.find(c => c.canvas && c.canvas.id === 'requestsOverTimeChart');
        if (requestsOverTimeChart) {
          requestsOverTimeChart.data.labels = requestsOverTimeLabels;
          requestsOverTimeChart.data.datasets[0].data = requestsOverTimeData;
          requestsOverTimeChart.update();
          if (chartConfigs['requestsOverTimeChart']) {
            chartConfigs['requestsOverTimeChart'].config.data.labels = requestsOverTimeLabels;
            chartConfigs['requestsOverTimeChart'].config.data.datasets[0].data = requestsOverTimeData;
          }
        }

        const cacheOverTimeChart = charts.find(c => c.canvas && c.canvas.id === 'cacheOverTimeChart');
        if (cacheOverTimeChart) {
          cacheOverTimeChart.data.labels = cacheOverTimeLabels;
          cacheOverTimeChart.data.datasets[0].data = cacheOverTimeData;
          cacheOverTimeChart.update();
          if (chartConfigs['cacheOverTimeChart']) {
            chartConfigs['cacheOverTimeChart'].config.data.labels = cacheOverTimeLabels;
            chartConfigs['cacheOverTimeChart'].config.data.datasets[0].data = cacheOverTimeData;
          }
        }

        // 7. Latency Distribution
        const newLatencyBins = {
          '0-50ms': 0,
          '50-100ms': 0,
          '100-200ms': 0,
          '200-500ms': 0,
          '500-1000ms': 0,
          '1000ms+': 0,
        };

        latVals.forEach((latency) => {
          if (latency <= 50) newLatencyBins['0-50ms']++;
          else if (latency <= 100) newLatencyBins['50-100ms']++;
          else if (latency <= 200) newLatencyBins['100-200ms']++;
          else if (latency <= 500) newLatencyBins['200-500ms']++;
          else if (latency <= 1000) newLatencyBins['500-1000ms']++;
          else newLatencyBins['1000ms+']++;
        });

        const latencyDistributionChart = charts.find(c => c.canvas && c.canvas.id === 'latencyDistributionChart');
        if (latencyDistributionChart) {
          latencyDistributionChart.data.datasets[0].data = Object.values(newLatencyBins);
          latencyDistributionChart.update();
          if (chartConfigs['latencyDistributionChart']) {
            chartConfigs['latencyDistributionChart'].config.data.datasets[0].data = Object.values(newLatencyBins);
          }
        }

        // 8. Top Players Chart
        const topPlayersLabels = topPlayers.slice(0, 20).map(p => p.resolvedUsername || p.identifier);
        const topPlayersDataArr = topPlayers.slice(0, 20).map(p => p.queryCount);
        
        const topPlayersChart = charts.find(c => c.canvas && c.canvas.id === 'topPlayersChart');
        if (topPlayersChart) {
          topPlayersChart.data.labels = topPlayersLabels;
          topPlayersChart.data.datasets[0].data = topPlayersDataArr;
          topPlayersChart.update();
          if (chartConfigs['topPlayersChart']) {
            chartConfigs['topPlayersChart'].config.data.labels = topPlayersLabels;
            chartConfigs['topPlayersChart'].config.data.datasets[0].data = topPlayersDataArr;
          }
        }

        updateChartAriaLabels({
          filters: activeFilters,
          cacheHits: cacheHitsCount,
          cacheMisses: totalReqs - cacheHitsCount,
          starRanges: newStarRanges,
          statusBuckets: newStatusBuckets,
          lookupTypeCounts: newLookupTypeCounts,
          requestsOverTimeData,
          cacheOverTimeData,
          latencyBins: newLatencyBins,
          topPlayersLabels,
          topPlayersData: topPlayersDataArr,
          latencySeriesCount: getLatencySeriesCount(),
          includeCacheHits,
        });
        
        // 6. Update Recent Player Lookups Table
        if (pageData && pageData.rows) {
          const tbody = document.querySelector('table tbody');
          if (tbody) {
            const rowsHtml = pageData.rows.map((entry) => {
              const lookupIdentifier =
                entry.lookupType === 'uuid' && entry.resolvedUsername
                  ? entry.resolvedUsername
                  : entry.identifier;
              const lookup = \`\${entry.lookupType.toUpperCase()}: \${lookupIdentifier}\`;
              const resolved = entry.nicked === true ? '(nicked)' : entry.resolvedUsername ?? entry.resolvedUuid ?? 'unknown';
              const cacheSource = entry.cacheHit ? 'Cache' : entry.cacheSource === 'network' ? 'Network' : entry.cacheSource;
              
              const encodedIdentifier = encodeURIComponent(entry.identifier);
              const lookupLink = entry.lookupType === 'uuid'
                ? \`https://namemc.com/profile/\${encodedIdentifier}\`
                : \`https://namemc.com/search?q=\${encodedIdentifier}\`;
              
              return \`<tr>
                <td title="\${escapeHtmlClient(formatDateClient(entry.requestedAt))}">\${escapeHtmlClient(timeAgoClient(entry.requestedAt))}</td>
                <td><a href="\${lookupLink}" target="_blank" rel="noopener noreferrer" class="lookup-link">\${escapeHtmlClient(lookup)}</a></td>
                <td>\${escapeHtmlClient(resolved)}</td>
                <td class="stars">\${escapeHtmlClient(formatStarsClient(entry.stars))}</td>
                <td>\${escapeHtmlClient(cacheSource)}\${entry.revalidated ? ' <span class="tag">revalidated</span>' : ''}</td>
                <td>\${escapeHtmlClient(String(entry.responseStatus))}</td>
                <td class="latency">\${escapeHtmlClient(formatLatencyClient(entry.latencyMs))}</td>
              </tr>\`;
            }).join('\\n');
            
            tbody.innerHTML = rowsHtml || '<tr><td colspan="7">No lookups recorded yet.</td></tr>';
          }
        }
        
        // Update "last refreshed" indicator
        if (refreshCountdownEl) refreshCountdownEl.textContent = 'Updated just now';
      }

      // Event Listeners
      if (autoRefreshToggle) {
        autoRefreshToggle.addEventListener('change', (e) => {
          autoRefreshEnabled = e.target.checked;
          try {
            window.localStorage.setItem('autoRefreshEnabled', autoRefreshEnabled);
          } catch (err) { /* ignore */ }
          
          if (autoRefreshEnabled) {
            fetchLatestData(); // Fetch immediately on enable
          } else {
            stopAutoRefreshLogic();
          }
        });
      }
      
      if (refreshIntervalSelect) {
        refreshIntervalSelect.addEventListener('change', (e) => {
          refreshIntervalMs = parseInt(e.target.value, 10);
          try {
            window.localStorage.setItem('refreshIntervalMs', refreshIntervalMs);
          } catch (err) { /* ignore */ }
          
          if (autoRefreshEnabled) {
            // Restart timer with new interval
            scheduleNextRefresh();
          }
        });
      }
      
      if (refreshNowBtn) {
        refreshNowBtn.addEventListener('click', () => {
          fetchLatestData();
        });
      }
      
      // Start auto-refresh if enabled from localStorage
      if (autoRefreshEnabled) {
        scheduleNextRefresh();
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
