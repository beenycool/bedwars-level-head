# Levelhead Proxy Backend

This folder contains a minimal HTTP API that the Levelhead BedWars mod can tunnel through. It proxies requests to Hypixel with a static API key and surfaces player-facing error messages that the mod can display in chat.

## Quick start (Docker Compose)

The easiest way to self-host the backend is with Docker Compose. The provided stack launches the Node.js API and a SQL cache database (PostgreSQL or Azure SQL).

1. Install [Docker](https://docs.docker.com/get-docker/) and [Docker Compose](https://docs.docker.com/compose/).
2. Copy the example environment file and fill in the required values:

   ```bash
   cd backend
   cp .env.example .env
   # edit .env and set HYPIXEL_API_KEY at minimum
   ```
3. Build and start the stack:

   ```bash
   docker compose up -d
   ```

4. View the logs to confirm everything is healthy:

   ```bash
   docker compose logs -f backend
   ```

The backend will be available on port 3000 by default. All settings can be overridden in `.env`.

To stop the services run `docker compose down`. The PostgreSQL volume (`cache-data`) persists cached data between restarts.

## Manual setup

If you prefer running the services yourself:

1. Install Node.js 20+, npm, and PostgreSQL 14+.
2. Copy `.env.example` to `.env` and configure the required values.
3. Install dependencies and build the project:

   ```bash
   cd backend
   npm install
   npm run build
   ```

4. Start the server:

   ```bash
   npm start
   ```

   During development you can run `npm run dev` to use `ts-node-dev` with automatic restarts.

Ensure the configured `CACHE_DB_URL` points at a reachable SQL instance (PostgreSQL or Azure SQL). The backend automatically creates the `player_stats_cache` and `ign_uuid_cache` tables on startup.

## Configuration reference

The backend uses environment variables for all secrets and tunables. The `.env.example` file documents sensible defaults for self-hosting. The table below lists every supported option:

| Variable | Required | Description |
| --- | --- | --- |
| `HYPIXEL_API_KEY` | ✅ | Hypixel API key owned by the proxy operator. |
| `CACHE_DB_URL` | ✅ | Database connection string for the response cache. Supports PostgreSQL and Azure SQL. |
| `AZURE_SQL_TRUST_SERVER_CERTIFICATE` | ❌ | Set to `true` to skip Azure SQL certificate validation (defaults to `false`). |
| `ADMIN_API_KEYS` | ✅ | Comma-separated list of tokens required to access administrative endpoints. |
| `CRON_API_KEYS` | ❌ | Comma-separated list of tokens required to access cron endpoints. Cron routes are only mounted when configured. |
| `RATE_LIMIT_MAX` | ❌ | Requests per IP allowed per window (defaults to `300`). |
| `RATE_LIMIT_WINDOW_MS` | ❌ | Window length in milliseconds for the private route limit (defaults to `300000`, i.e. 5 minutes). |
| `PUBLIC_RATE_LIMIT_MAX` | ❌ | Requests per IP allowed per window on public routes (defaults to `60`). |
| `PUBLIC_RATE_LIMIT_WINDOW_MS` | ❌ | Window length for public route rate limits (defaults to `60000`, i.e. 1 minute). |
| `CRON_RATE_LIMIT_MAX` | ❌ | Requests per IP allowed per window on cron routes (defaults to `10`). |
| `CRON_RATE_LIMIT_WINDOW_MS` | ❌ | Window length for cron route rate limits (defaults to `3600000`, i.e. 1 hour). |
| `PORT` | ❌ | Port to bind to (defaults to `3000`). |
| `HOST` | ❌ | Host/IP to bind to (defaults to `0.0.0.0`). |
| `HYPIXEL_API_BASE_URL` | ❌ | Override for Hypixel API base URL. |
| `CLOUDFLARE_TUNNEL` | ❌ | Optional Cloudflare Tunnel URL printed on boot. |
| `CACHE_TTL_MS` | ❌ | Legacy cache TTL (unused by minimal stats cache). |
| `PLAYER_L2_TTL_MS` | ❌ | SQL (L2) player stats TTL in milliseconds (defaults to 72 hours, clamped 1-72 hours). |
| `IGN_L2_TTL_MS` | ❌ | SQL (L2) IGN mapping TTL in milliseconds (defaults to `PLAYER_L2_TTL_MS`). |
| `PLAYER_L1_TTL_MIN_MS` | ❌ | Minimum Redis (L1) TTL in milliseconds for player stats (defaults to 15 minutes). |
| `PLAYER_L1_TTL_MAX_MS` | ❌ | Maximum Redis (L1) TTL in milliseconds for player stats (defaults to 6 hours). |
| `PLAYER_L1_TTL_FALLBACK_MS` | ❌ | Fallback Redis TTL when memory telemetry is missing (defaults to 2 hours). |
| `PLAYER_L1_TARGET_UTILIZATION` | ❌ | Target Redis memory utilization for adaptive TTL (defaults to `0.7`). |
| `PLAYER_L1_SAFETY_FACTOR` | ❌ | Safety factor applied to time-to-full estimate (defaults to `0.6`). |
| `PLAYER_L1_INFO_REFRESH_MS` | ❌ | How often to sample Redis memory info for TTL adaptation (defaults to 5 minutes). |
| `REDIS_CACHE_MAX_BYTES` | ❌ | Assumed Redis max memory when `maxmemory=0` (defaults to 30MB). |
| `CACHE_DB_WARM_WINDOW_MS` | ❌ | Only read L2 if the DB was used recently (defaults to 15 minutes). |
| `CACHE_DB_ALLOW_COLD_READS` | ❌ | Allow L2 reads that wake a paused serverless DB (defaults to `false`). |
| `CACHE_DB_POOL_MIN` | ❌ | Minimum connections in the PostgreSQL pool (defaults to `0`). |
| `CACHE_DB_POOL_MAX` | ❌ | Maximum connections in the PostgreSQL pool (defaults to `10`). |
| `HYPIXEL_TIMEOUT_MS` | ❌ | Hypixel API request timeout (defaults to `5000`). |
| `HYPIXEL_RETRY_DELAY_MIN_MS` | ❌ | Minimum retry backoff when calling the Hypixel API (defaults to `50`). |
| `HYPIXEL_RETRY_DELAY_MAX_MS` | ❌ | Maximum retry backoff when calling the Hypixel API (defaults to `150`). |
| `TRUST_PROXY_CIDRS` | ✅ (production) | Comma-separated CIDR allowlist for trusted reverse proxies used for forwarded IP parsing. Required in production (or when `CLOUDFLARE_TUNNEL` is set). |
| `MONITORING_ALLOWED_CIDRS` | ❌ | Comma-separated CIDR allowlist for operational endpoints (`/metrics`, `/stats`, and detailed `/healthz`). Defaults to loopback only. |
| `REDIS_KEY_SALT` | ✅ (production) | Secret salt used when hashing client IPs into Redis keys. Must be 32+ characters in production. |
| `BACKEND_VERSION` | ❌ | Overrides the version string used in outbound `User-Agent` headers and Prometheus build metrics. Defaults to `package.json` version. |
| `BUILD_SHA` | ❌ | Optional revision/Git SHA included in outbound `User-Agent` headers and Prometheus build metrics. |
| `RATE_LIMIT_REQUIRE_REDIS` | ❌ | If true, Redis is mandatory for rate limiting. Defaults to `true` in production, `false` otherwise. |
| `RATE_LIMIT_FALLBACK_MODE` | ❌ | Fallback behavior when Redis is unavailable (`deny`, `allow`, or `memory`). Defaults to `deny` in production, `memory` otherwise. |
| `GLOBAL_JOBS_LEADER_LOCK_KEY` | ❌ | Redis key used for leader election that coordinates global maintenance jobs across replicas. |
| `GLOBAL_JOBS_LEADER_TTL_MS` | ❌ | Redis lease TTL for the leader lock in milliseconds (defaults to `15000`, min `5000`). |
| `GLOBAL_JOBS_LEADER_RETRY_MS` | ❌ | Leader election heartbeat/retry interval in milliseconds (defaults to `5000`, min `1000`). |

Set these variables in your deployment environment or `.env` file.

### Database support

The backend supports two database providers for caching and history:

1.  **PostgreSQL** (default): Use a connection string starting with `postgresql://` or `postgres://`.
2.  **Azure SQL Database**: Use a connection string starting with `sqlserver://` or `mssql://`.

Example Azure SQL connection string:
`sqlserver://levelhead.database.windows.net:1433;database=cache;user=admin;password=secret;encrypt=true`

When using Azure SQL Free Tier, ensure your connection string includes `encrypt=true` as required by Azure. The backend will automatically detect the database type and adjust its SQL syntax accordingly.

### Administrative access

Administrative endpoints require clients to present a valid API token via one of the following methods:

- `Authorization: Bearer <token>` header (recommended)
- `X-Admin-Token: <token>` header

Query string authentication is explicitly rejected to avoid leaking secrets via logs, proxies, or browser history. Multiple tokens can be configured by providing a comma-separated list in `ADMIN_API_KEYS`.

### Cron access

Cron endpoints require clients to present a valid API token via one of the following methods:

- `Authorization: Bearer <token>` header (recommended)
- `X-Cron-Token: <token>` header

Multiple tokens can be configured by providing a comma-separated list in `CRON_API_KEYS`.

### Proxy awareness

Set `TRUST_PROXY_CIDRS` to match your ingress/CDN topology so that rate limiting and logging see the correct client IP. Examples:

- `TRUST_PROXY_CIDRS=127.0.0.1/32` – trust only local reverse proxy.
- `TRUST_PROXY_CIDRS=10.0.0.0/8,172.16.0.0/12` – trust known private subnets.
- `TRUST_PROXY_CIDRS=173.245.48.0/20,103.21.244.0/22,...` – trust published CDN ingress ranges.

If you deploy behind Cloudflare Tunnel, Nginx, or another load balancer, document the exact CIDR list so future operators do not accidentally trust untrusted forwarded headers.

### Cache TTL and validators

Cached player stats honor validators (`ETag`, `Last-Modified`) returned by Hypixel. Clients should send `If-None-Match`/`If-Modified-Since` (and optionally `Cache-Control: max-age=0`) when reusing cached data so the proxy can respond with `304 Not Modified` instead of a full payload. The backend uses the same headers when calling upstream. Redis (L1) TTLs are adaptive based on memory pressure and clamped by `PLAYER_L1_TTL_MIN_MS`/`PLAYER_L1_TTL_MAX_MS`; SQL (L2) TTLs use `PLAYER_L2_TTL_MS`.

### Rate limiting scope

The built-in rate limiter stores buckets in memory, so limits apply per process. When scaling horizontally you should either deploy a shared limiter (e.g., Redis) or note the per-instance behavior in your runbooks so operators can size fleets conservatively. Short-lived in-memory request deduplication also operates per instance, so duplicate cache fetches may occur briefly after scaling out.

### Outbound identification

Requests to Hypixel and Mojang include a `User-Agent` string of the form `Levelhead-Proxy/<version> (rev:<sha>)`. Set `BACKEND_VERSION` and `BUILD_SHA` to override these values when deploying custom builds so upstream providers can correlate traffic with your release.

## API Endpoints

### Cron Routes

- `POST /api/cron/ping` - Authenticated ping endpoint for uptime monitoring. Requires a cron token and is rate-limited per client IP using the `CRON_RATE_LIMIT_*` configuration.

### Player Routes

- `GET /api/player/:identifier` - Get minimal player stats by UUID or username. This route is rate-limited per client IP using the `RATE_LIMIT_*` configuration.
- `GET /api/public/player/:identifier` - Get minimal player stats by UUID or username. This route is rate-limited per client IP using the more restrictive `PUBLIC_RATE_LIMIT_*` configuration.

Minimal stats responses include:
`displayname`, `bedwars_experience`, `bedwars_final_kills`, `bedwars_final_deaths`,
`duels_wins`, `duels_losses`, `duels_kills`, `duels_deaths`,
`skywars_experience`, `skywars_wins`, `skywars_losses`, `skywars_kills`, `skywars_deaths`.

### Admin Routes

- `POST /api/admin/cache/purge` - Purge cache entries for a specific UUID/IGN or clear the entire cache. Requires an admin token and is rate-limited per client IP using the `RATE_LIMIT_*` configuration.

### Other Routes

- `GET /stats` - Statistics endpoint (restricted to monitoring allowlist or valid admin/cron token)
- `GET /healthz` - Health check endpoint (public, with detailed checks only for monitoring-authenticated callers)
- `GET /metrics` - Prometheus metrics endpoint (restricted to monitoring allowlist or valid admin/cron token)

Successful responses return the minimal stats payload; ensure clients expect the reduced shape.
