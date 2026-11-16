# Levelhead Proxy Backend

One small Express + TypeScript service in front of the Hypixel API. It holds the
backend's Hypixel key and caches minimal stats so the mod never needs a personal key.

The player endpoints return exactly what the mod parses: the flat minimal stats
object plus `nicked`, or `{ success, data }` keyed by UUID for batches.

## Run

```bash
cd backend
cp .env.example .env      # set HYPIXEL_API_KEY
npm ci
npm run dev               # or: npm run build && npm start
```

`HYPIXEL_API_KEY` is the only required variable. `CACHE_DB_URL` is optional:
without it the service runs from a 10-minute in-process cache and still serves
data. With it, PostgreSQL keeps `player_stats_cache` rows for 24 hours and feeds
the `/stats` tracking page described below.

On Render, `render.yaml` runs the image on the **starter** plan so the instance
does not sleep; there is deliberately no `/api/cron/ping` pinger.

## Endpoints

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/public/player/:uuid` | Single player, UUID (dashes optional) |
| `POST` | `/api/public/player/batch` | `{ "uuids": [...] }`, up to 20 (dashes optional, case-insensitive) |
| `GET` | `/api/player/...` | Legacy alias for the two routes above; same data, same rate-limit bucket |
| `GET` | `/healthz` | Liveness. No auth, no rate limit |
| `GET` | `/stats` | Server-rendered tracking page (`range`, `sort`, `q`, `page`) |
| `GET` | `/stats/export.csv` | Same filters, CSV download |
| `POST` | `/api/admin/cache/purge` | Only mounted when `ADMIN_API_KEYS` is set |

Batch requests are failure-isolated: a player that Hypixel rejects is omitted from
`data` (the mod retries it later). The batch only fails with `503` when the upstream
is unusable for every identifier (circuit breaker open, 5xx or upstream 429).

## Tracking

`/stats` is the pre-rewrite analytics page, rebuilt without Chart.js:

- **Overview** — total lookups, cache hit rate, success rate and a selectable latency
  percentile (p50/p95/p99/min/max/avg), plus infrastructure and process cards.
- **Charts** — cache performance, star distribution, latency pulse, status breakdown,
  request routes, requests over time, cache hit rate over time, latency distribution,
  top queried players and process memory, all server-rendered SVG.
- **Recent Player Lookups** — one row per lookup, searchable, sortable and exportable
  as CSV.

One table keeps storage bounded:

- `lookup_log` — one append-only row per lookup, including failures. This is what the
  per-lookup table, percentiles and distributions read. Rows older than
  `LOOKUP_LOG_RETENTION_DAYS` are pruned hourly.

Only 32-character UUIDs are recorded; rejected usernames and malformed identifiers
never reach the tables. Set `LOOKUP_TRACKING_ENABLED=false` to record nothing at
all — the player endpoints keep working and `/stats` reports no data.

## Rate limiting

Each client IP gets its own in-memory token bucket. The ceiling is dynamic:
every ten seconds the limiter divides the remaining Hypixel hourly quota by the
number of active clients and recent demand, then widens it by the observed cache
hit rate. Budgets stay between `DYNAMIC_RATE_LIMIT_MIN` and
`DYNAMIC_RATE_LIMIT_MAX` (default 20–600 identifiers/minute). A full BedWars hub
is one burst; each identifier in a batch costs one token. Cache hits refund that
token because no upstream work happened, so cached lookups are free against the
identifier budget. A separate fixed guard (`PUBLIC_REQUEST_LIMIT_MAX`, default
1,200/minute) still caps HTTP requests so a cached-request flood cannot exhaust
the process. `/healthz` bypasses both limiters.

Set `DYNAMIC_RATE_LIMIT_ENABLED=false` to use the flat `PUBLIC_RATE_LIMIT_MAX`
budget instead. There is no Redis dependency and no fail-closed mode.

## Configuration

See `.env.example`. The short version:

- `HYPIXEL_API_KEY` (required)
- `CACHE_DB_URL` (optional PostgreSQL)
- `ADMIN_API_KEYS` (optional admin purge)
- `TRUST_PROXY_CIDRS` (optional; one proxy hop is trusted in production when unset)
- `PUBLIC_RATE_LIMIT_MAX` (default 600/minute)
- `PUBLIC_REQUEST_LIMIT_MAX` (default 1,200 requests/minute; cached traffic guard)
- `DYNAMIC_RATE_LIMIT_ENABLED` (default true)
- `DYNAMIC_RATE_LIMIT_MIN` / `DYNAMIC_RATE_LIMIT_MAX` (default 20 / 600 per minute)
- `DYNAMIC_RATE_LIMIT_CACHE_TTL_MS` (default 10s)
- `HYPIXEL_HOURLY_QUOTA` (default 7200 calls/hour)
- `PLAYER_CACHE_DB_TTL_MS` (default 24h)
- `LOOKUP_TRACKING_ENABLED` (default true; `false` disables `/stats` recording)
- `LOOKUP_LOG_RETENTION_DAYS` (default 30)
- `PORT`, `HOST`, `HYPIXEL_TIMEOUT_MS` (defaults: 3000, 0.0.0.0, 5000)

