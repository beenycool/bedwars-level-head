import { Router } from 'express';
import { getRecentPlayerQueries } from '../services/history';
import { getCacheEntry } from '../services/cache';
import { ProxyPlayerPayload } from '../services/hypixel';
import { buildPlayerCacheKey, extractDisplayName } from '../services/player';
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

function normalizeUuid(uuid: string): string {
  return uuid.replace(/-/g, '').toLowerCase();
}

async function hydrateMissingUsernames(history: Awaited<ReturnType<typeof getRecentPlayerQueries>>) {
  const missingUuidList = history
    .filter((entry) => entry.resolvedUuid && !entry.resolvedUsername && entry.nicked !== true)
    .map((entry) => normalizeUuid(entry.resolvedUuid!));

  const uniqueUuids = Array.from(new Set(missingUuidList));
  const resolvedNames = new Map<string, string>();

  await Promise.all(
    uniqueUuids.map(async (uuid) => {
      const cacheKey = buildPlayerCacheKey(uuid);
      const cacheEntry = await getCacheEntry<ProxyPlayerPayload>(cacheKey, true);
      if (!cacheEntry) {
        return;
      }

      const displayName = extractDisplayName(cacheEntry.value);
      if (displayName) {
        resolvedNames.set(uuid, displayName);
      }
    }),
  );

  return resolvedNames;
}

router.get('/', async (_req, res, next) => {
  try {
    const history = await getRecentPlayerQueries(50);
    const cachedNames = await hydrateMissingUsernames(history);
    const rows = history
      .map((entry) => {
        const lookup = `${entry.lookupType.toUpperCase()}: ${entry.identifier}`;
        const normalizedUuid = entry.resolvedUuid ? normalizeUuid(entry.resolvedUuid) : null;
        const resolvedFromCache = normalizedUuid ? cachedNames.get(normalizedUuid) : null;
        const resolved =
          entry.nicked === true
            ? '(nicked)'
            : resolvedFromCache ?? entry.resolvedUsername ?? entry.resolvedUuid ?? 'unknown';
        const cacheSource = entry.cacheHit ? 'Cache' : entry.cacheSource === 'network' ? 'Network' : entry.cacheSource;

        return `<tr>
          <td>${escapeHtml(formatDate(entry.requestedAt))}</td>
          <td>${escapeHtml(lookup)}</td>
          <td data-uuid="${escapeHtml(normalizedUuid ?? '')}" data-missing-name="${resolvedFromCache ? 'false' : 'true'}">${escapeHtml(resolved)}</td>
          <td class="stars">${escapeHtml(formatStars(entry.stars))}</td>
          <td>${escapeHtml(cacheSource)}${entry.revalidated ? ' <span class="tag">revalidated</span>' : ''}</td>
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
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        ${rows || '<tr><td colspan="6">No lookups recorded yet.</td></tr>'}
      </tbody>
    </table>
    <script>
      (() => {
        const cells = Array.from(document.querySelectorAll('td[data-uuid][data-missing-name="true"]'));
        const seen = new Set();
        cells.forEach((cell) => {
          const uuid = (cell.getAttribute('data-uuid') || '').replace(/-/g, '').toLowerCase();
          if (!uuid || seen.has(uuid)) {
            return;
          }
          seen.add(uuid);
          fetch(`https://api.ashcon.app/mojang/v2/user/${uuid}`)
            .then((response) => (response.ok ? response.json() : null))
            .then((data) => {
              const name = data?.username;
              if (!name) return;
              document.querySelectorAll(`td[data-uuid="${uuid}"]`).forEach((target) => {
                target.textContent = name;
                target.setAttribute('data-missing-name', 'false');
              });
            })
            .catch(() => {});
        });
      })();
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
