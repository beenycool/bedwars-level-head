# Levelhead Proxy Backend

The backend for the BedWars Levelhead mod. It sits between the mod and the Hypixel API, handling lookups with a server-side API key so individual users don't need their own. Responses are cached in a two-tier setup (Redis L1, SQL L2) to keep things fast and avoid hitting Hypixel's rate limits.

Built with Express + TypeScript, targeting Node.js 20+.

## Quick Start (Docker Compose)

1. Install [Docker](https://docs.docker.com/get-docker/) and [Docker Compose](https://docs.docker.com/compose/).
2. Set up your environment:

   ```bash
   cd backend
   cp .env.example .env
   # edit .env -- at minimum set HYPIXEL_API_KEY
   ```

3. Start everything:

   ```bash
   docker compose up -d
   ```

4. Check the logs:

   ```bash
   docker compose logs -f backend
   ```

The backend listens on port 3000 by default. The PostgreSQL volume (`cache-data`) persists between restarts. Stop with `docker compose down`.

## Manual Setup

1. Install Node.js 20+, npm, and PostgreSQL 14+.
2. Copy `.env.example` to `.env` and fill in the required values.
3. Install and build:

   ```bash
   cd backend
   npm install
   npm run build
   ```

4. Run:

   ```bash
   npm start
   ```

   For development with auto-restart: `npm run dev`.

The backend auto-creates the `player_stats_cache` and `ign_uuid_cache` tables on startup, so you just need a reachable database.

## API Endpoints

### Player routes

| Method | Path | Description |
|---|---|---|
| GET | `/api/player/:identifier` | Look up stats by UUID or username (private rate limit) |
| GET | `/api/public/player/:identifier` | Same, but with stricter public rate limits |

Responses include: `displayname`, `bedwars_experience`, `bedwars_final_kills`, `bedwars_final_deaths`, `duels_wins`, `duels_losses`, `duels_kills`, `duels_deaths`, `skywars_experience`, `skywars_wins`, `skywars_losses`, `skywars_kills`, `skywars_deaths`.

### Admin routes

| Method | Path | Description |
|---|---|---|
| POST | `/api/admin/cache/purge` | Purge cache for a specific player or everything |

Requires an `Authorization: Bearer <token>` or `X-Admin-Token: <token>` header. Query string auth is rejected to avoid leaking tokens in logs.

### Cron routes

| Method | Path | Description |
|---|---|---|
| POST | `/api/cron/ping` | Authenticated ping for uptime monitoring |

Requires an `Authorization: Bearer <token>` or `X-Cron-Token: <token>` header. Only mounted when `CRON_API_KEYS` is set.

### Operational routes

| Method | Path | Description |
|---|---|---|
| GET | `/healthz` | Health check (public; detailed info requires monitoring auth) |
| GET | `/stats` | Backend statistics (restricted to monitoring allowlist or admin/cron token) |
| GET | `/metrics` | Prometheus metrics (same restrictions as `/stats`) |

## Configuration

Everything is configured through environment variables (or a `.env` file). See `.env.example` for documented defaults.

### Required variables

| Variable | Description |
|---|---|
| `HYPIXEL_API_KEY` | Your Hypixel API key |
| `CACHE_DB_URL` | Database connection string (PostgreSQL or Azure SQL) |
| `ADMIN_API_KEYS` | Comma-separated admin tokens |
| `TRUST_PROXY_CIDRS` | CIDR allowlist for trusted reverse proxies (required in production) |
| `REDIS_KEY_SALT` | Salt for hashing client IPs in Redis keys (32+ chars, required in production) |

### Database support

Two database providers are supported:

- **PostgreSQL** (default) -- connection strings starting with `postgresql://` or `postgres://`
- **Azure SQL** -- connection strings starting with `sqlserver://` or `mssql://`

The backend detects the type automatically from the URL scheme. Azure SQL connections need `encrypt=true` in the connection string.

### Caching

The cache has two layers:

- **L1 (Redis)**: Fast, in-memory. TTLs are adaptive based on Redis memory pressure, clamped between `PLAYER_L1_TTL_MIN_MS` (default 15 min) and `PLAYER_L1_TTL_MAX_MS` (default 6 hours).
- **L2 (SQL)**: Durable, slower. TTL controlled by `PLAYER_L2_TTL_MS` (default 72 hours).

Cached responses honor `ETag` and `Last-Modified` from Hypixel, so clients can use conditional requests to get `304 Not Modified` responses.

### Rate limiting

Three separate rate limit tiers:

| Tier | Default max | Default window | Used by |
|---|---|---|---|
| Private | 300 | 5 minutes | `/api/player/` |
| Public | 60 | 1 minute | `/api/public/player/` |
| Cron | 10 | 1 hour | `/api/cron/` |

Rate limit state is stored in Redis when available. The `RATE_LIMIT_FALLBACK_MODE` controls what happens if Redis goes down: `deny` (reject all, default in prod), `allow` (let everything through), or `memory` (per-instance in-memory limits, default in dev).

### Proxy awareness

Set `TRUST_PROXY_CIDRS` to match your infrastructure so rate limiting sees the real client IP:

```
# local reverse proxy only
TRUST_PROXY_CIDRS=127.0.0.1/32

# private subnets
TRUST_PROXY_CIDRS=10.0.0.0/8,172.16.0.0/12

# Cloudflare ingress ranges
TRUST_PROXY_CIDRS=173.245.48.0/20,103.21.244.0/22,...
```

### Leader election

When running multiple replicas, the backend uses Redis-based leader election (`GLOBAL_JOBS_LEADER_LOCK_KEY`) to make sure global maintenance tasks (like cache cleanup) only run on one instance.

### Outbound identification

Requests to Hypixel and Mojang use a `User-Agent` of the form `Levelhead-Proxy/<version> (rev:<sha>)`. Override with `BACKEND_VERSION` and `BUILD_SHA` if you're running a custom build.

## Full Environment Variable Reference

See the [.env.example](.env.example) file for all supported variables with comments. The table below covers the optional tuning knobs not mentioned above:

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Port to bind to |
| `HOST` | `0.0.0.0` | Host to bind to |
| `CRON_API_KEYS` | -- | Comma-separated cron tokens (cron routes only mount if set) |
| `HYPIXEL_API_BASE_URL` | Hypixel default | Override Hypixel API base URL |
| `HYPIXEL_TIMEOUT_MS` | `5000` | Hypixel request timeout |
| `HYPIXEL_RETRY_DELAY_MIN_MS` | `50` | Min retry backoff for Hypixel calls |
| `HYPIXEL_RETRY_DELAY_MAX_MS` | `150` | Max retry backoff |
| `PLAYER_L2_TTL_MS` | 72 hours | SQL cache TTL (clamped 1-72h) |
| `IGN_L2_TTL_MS` | same as L2 | SQL IGN mapping TTL |
| `PLAYER_L1_TTL_FALLBACK_MS` | 2 hours | Redis TTL when memory info is unavailable |
| `PLAYER_L1_TARGET_UTILIZATION` | `0.7` | Target Redis memory utilization |
| `PLAYER_L1_SAFETY_FACTOR` | `0.6` | Safety factor for time-to-full estimate |
| `PLAYER_L1_INFO_REFRESH_MS` | 5 min | Redis memory sampling interval |
| `REDIS_CACHE_MAX_BYTES` | 30 MB | Assumed Redis max memory if `maxmemory=0` |
| `CACHE_DB_WARM_WINDOW_MS` | 15 min | Only read L2 if DB was used recently |
| `CACHE_DB_ALLOW_COLD_READS` | `false` | Allow L2 reads that wake a paused serverless DB |
| `CACHE_DB_POOL_MIN` | `0` | Min PostgreSQL pool connections |
| `CACHE_DB_POOL_MAX` | `10` | Max PostgreSQL pool connections |
| `AZURE_SQL_TRUST_SERVER_CERTIFICATE` | `false` | Skip Azure SQL cert validation |
| `CLOUDFLARE_TUNNEL` | -- | Optional tunnel URL printed on boot |
| `MONITORING_ALLOWED_CIDRS` | loopback | CIDR allowlist for `/metrics`, `/stats`, detailed `/healthz` |
| `BACKEND_VERSION` | from package.json | Version for User-Agent and Prometheus |
| `BUILD_SHA` | -- | Git SHA for User-Agent and Prometheus |
| `GLOBAL_JOBS_LEADER_TTL_MS` | `15000` | Leader lock TTL (min 5000) |
| `GLOBAL_JOBS_LEADER_RETRY_MS` | `5000` | Leader heartbeat interval (min 1000) |
