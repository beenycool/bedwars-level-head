import { Router } from 'express';
import { getRecentPlayerQueries } from '../services/history';
import { escapeHtml } from '../util/html';

const router = Router();

function formatDate(date: Date): string {
  return date.toISOString();
}

function formatStars(stars: number | null): string {
  if (stars === null || Number.isNaN(stars)) {
    return '--';
  }

  return `${stars}`;
}

function formatInstallId(installId: string | null): string {
  if (!installId) {
    return '--';
  }

  return `${installId.slice(0, 12)}...`;
}

router.get('/', async (_req, res, next) => {
  try {
    const history = await getRecentPlayerQueries(50);
    const rows = history
      .map((entry) => {
        const lookup = `${entry.lookupType.toUpperCase()}: ${entry.identifier}`;
        const resolved =
          entry.nicked === true
            ? '(nicked)'
            : entry.resolvedUuid
              ? entry.resolvedUuid
              : entry.resolvedUsername ?? 'unknown';
        const cacheSource = entry.cacheHit ? 'Cache' : entry.cacheSource === 'network' ? 'Network' : entry.cacheSource;

        return `<tr>
          <td>${escapeHtml(formatDate(entry.requestedAt))}</td>
          <td>${escapeHtml(lookup)}</td>
          <td>${escapeHtml(resolved)}</td>
          <td class="stars">${escapeHtml(formatStars(entry.stars))}</td>
          <td>${escapeHtml(cacheSource)}${entry.revalidated ? ' <span class="tag">revalidated</span>' : ''}</td>
          <td>${escapeHtml(formatInstallId(entry.installId))}</td>
          <td>${entry.responseStatus}</td>
        </tr>`;
      })
      .join('\n');

    const html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Levelhead Player Stats</title>
    <style>
      :root {
        color-scheme: dark;
        font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: #0f172a;
        color: #e2e8f0;
      }
      body {
        margin: 0;
        padding: 2rem;
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
    </style>
  </head>
  <body>
    <h1>Recent Player Lookups</h1>
    <p class="meta">Showing the ${history.length} most recent queries recorded by the cache layer.</p>
    <table>
      <thead>
        <tr>
          <th>Queried At (UTC)</th>
          <th>Lookup</th>
          <th>Resolved</th>
          <th>Stars</th>
          <th>Source</th>
          <th>Install</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        ${rows || '<tr><td colspan="7">No lookups recorded yet.</td></tr>'}
      </tbody>
    </table>
  </body>
</html>`;

    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (error) {
    next(error);
  }
});

export default router;
