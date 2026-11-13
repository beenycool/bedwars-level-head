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
data. With it, one PostgreSQL table (`player_stats_cache`, auto-created) keeps
rows for 24 hours.

On Render, `render.yaml` runs the image on the **starter** plan so the instance
does not sleep; there is deliberately no `/api/cron/ping` pinger.

## Endpoints

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/public/player/:uuid` | Single player, undashed UUID |
| `POST` | `/api/public/player/batch` | `{ "uuids": [...] }`, up to 20 |
| `GET` | `/api/player/...` | Legacy alias for the two routes above; same data, same rate-limit bucket |
| `GET` | `/healthz` | Liveness. No auth, no rate limit |
| `POST` | `/api/admin/cache/purge` | Only mounted when `ADMIN_API_KEYS` is set |

Batch requests are failure-isolated: a player that Hypixel rejects is omitted from
`data` (the mod retries it later). The batch only fails with `503` when the upstream
is unusable for every identifier (circuit breaker open, 5xx or upstream 429).

## Rate limiting

A single in-memory token bucket per client IP, sized at `PUBLIC_RATE_LIMIT_MAX`
identifiers per minute (default 600). A full BedWars hub is one burst of ~100;
sustained traffic is held to the minute budget. There is no Redis dependency and
no fail-closed mode. `/healthz` bypasses the limiter.

## Configuration

See `.env.example`. The short version:

- `HYPIXEL_API_KEY` (required)
- `CACHE_DB_URL` (optional PostgreSQL)
- `ADMIN_API_KEYS` (optional admin purge)
- `TRUST_PROXY_CIDRS` (optional; one proxy hop is trusted in production when unset)
- `PUBLIC_RATE_LIMIT_MAX` (default 600/minute)
- `PLAYER_CACHE_DB_TTL_MS` (default 24h)
- `PORT`, `HOST`, `HYPIXEL_TIMEOUT_MS` (defaults: 3000, 0.0.0.0, 5000)

## Tests

```bash
npm ci
npm run typecheck
npm test
```
