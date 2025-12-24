# Levelhead Proxy Backend

This folder contains a minimal HTTP API that the Levelhead BedWars mod can tunnel through. It proxies requests to Hypixel with a static API key and surfaces player-facing error messages that the mod can display in chat.

## Quick start (Docker Compose)

The easiest way to self-host the backend is with Docker Compose. The provided stack launches the Node.js API and a PostgreSQL cache database.

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

Ensure the configured `CACHE_DB_URL` points at a reachable PostgreSQL instance. The backend automatically creates the `player_cache` table on startup.

## Configuration reference

The backend uses environment variables for all secrets and tunables. The `.env.example` file documents sensible defaults for self-hosting. The table below lists every supported option:

| Variable | Required | Description |
| --- | --- | --- |
| `HYPIXEL_API_KEY` | ✅ | Hypixel API key owned by the proxy operator. |
| `CACHE_DB_URL` | ✅ | PostgreSQL connection string for the response cache database. |
| `ADMIN_API_KEYS` | ✅ | Comma-separated list of tokens required to access administrative endpoints. |
| `CRON_API_KEYS` | ✅ | Comma-separated list of tokens required to access cron endpoints. |
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
| `CACHE_TTL_MS` | ❌ | Cache lifetime in milliseconds (defaults to 24 hours, clamped between 1-24 hours). |
| `CACHE_DB_POOL_MIN` | ❌ | Minimum connections in the PostgreSQL pool (defaults to `0`). |
| `CACHE_DB_POOL_MAX` | ❌ | Maximum connections in the PostgreSQL pool (defaults to `10`). |
| `HYPIXEL_TIMEOUT_MS` | ❌ | Hypixel API request timeout (defaults to `5000`). |
| `HYPIXEL_RETRY_DELAY_MIN_MS` | ❌ | Minimum retry backoff when calling the Hypixel API (defaults to `50`). |
| `HYPIXEL_RETRY_DELAY_MAX_MS` | ❌ | Maximum retry backoff when calling the Hypixel API (defaults to `150`). |
| `TRUST_PROXY` | ❌ | Express [trust proxy](https://expressjs.com/en/guide/behind-proxies.html) setting. Defaults to `false` to ignore forwarded IP headers. |
| `BACKEND_VERSION` | ❌ | Overrides the version string used in outbound `User-Agent` headers and Prometheus build metrics. Defaults to `package.json` version. |
| `BUILD_SHA` | ❌ | Optional revision/Git SHA included in outbound `User-Agent` headers and Prometheus build metrics. |

Set these variables in your deployment environment or `.env` file.

### Administrative access

Administrative endpoints require clients to present a valid API token via one of the following methods:

- `Authorization: Bearer <token>` header (recommended)
- `X-Admin-Token: <token>` header

QuerCron access

Cron endpoints require clients to present a valid API token via one of the following methods:

- `Authorization: Bearer <token>` header (recommended)
- `X-Cron-Token: <token>` header

Multiple tokens can be configured by providing a comma-separated list in `CRON_API_KEYS`.

### y string authentication is explicitly rejected to avoid leaking secrets via logs, proxies, or browser history. Multiple tokens can be configured by providing a comma-separated list in `ADMIN_API_KEYS`.

### Proxy awareness

Set the `TRUST_PROXY` value to match your ingress/CDN topology so that rate limiting and logging see the correct client IP. Examples:

- `TRUST_PROXY=false` (default) – use direct client IPs, ignoring `X-Forwarded-*`.
- `TRUST_PROXY=loopback` – trust headers from local reverse proxies such as Nginx on the same host.
- `TRUST_PROXY=1` – trust the first hop (Heroku-style single proxy).
- `TRUST_PROXY=cloudflare` – trust Cloudflare’s published ranges.
- `TRUST_PROXY=10.0.0.0/8` – trust requests forwarded by a known internal subnet.

If you deploy behind Cloudflare Tunnel, Nginx, or another load balancer, document the exact value you use so future operators do not accidentally collapse all IPs to the proxy address.

### Cache TTL and validators

Cached player payloads honor validators (`ETag`, `Last-Modified`) returned by Hypixel. Clients should send `If-None-Match`/`If-Modified-Since` (and optionally `Cache-Control: max-age=0`) when reusing cached data so the proxy can respond with `304 Not Modified` instead of a full payload. The backend uses the same headers when calling upstream. The `CACHE_TTL_MS` setting defaults to 24 hours and is clamped between 1 hour (3,600,000 ms) and 24 hours (86,400,000 ms); shorter values are automatically rounded up to 1 hour.

### Rate limiting scope

The built-in rate limiter stores buckets in memory, so limits apply per process. When scaling horizontally you should either deploy a shared limiter (e.g., Redis) or note the per-instance behavior in your runbooks so operators can size fleets conservatively. Short-lived in-memory request deduplication also operates per instance, so duplicate cache fetches may occur briefly after scaling out.

### Outbound identification

Requests to Hypixel and Mojang include a `User-Agent` string of the form `Levelhead-Proxy/<version> (rev:<sha>)`. Set `BACKEND_VERSION` and `BUILD_SHA` to override these values when deploying custom builds so upstream providers can correlate traffic with your release.

## API Endpoints

### Cron Routes

- `POST /api/cron/ping` - Authenticated ping endpoint for uptime monitoring. Requires a cron token and is rate-limited per client IP using the `CRON_RATE_LIMIT_*` configuration.

### Player Routes

- `GET /api/player/:identifier` - Get player data by UUID or username. This route is rate-limited per client IP using the `RATE_LIMIT_*` configuration.
- `GET /api/public/player/:identifier` - Get player data by UUID or username. This route is rate-limited per client IP using the more restrictive `PUBLIC_RATE_LIMIT_*` configuration.

### Admin Routes

- `POST /api/admin/cache/purge` - Purge cache entries for a specific UUID/IGN or clear the entire cache. Requires an admin token and is rate-limited per client IP using the `RATE_LIMIT_*` configuration.

### Other Routes

- `GET /stats` - Statistics endpoint (public)
- `GET /healthz` - Health check endpoint (public)
- `GET /metrics` - Prometheus metrics endpoint (public)

Successful responses mirror the shapes already supported by the mod so no client update is required.
