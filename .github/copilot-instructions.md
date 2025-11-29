Purpose
-------
This file helps AI coding agents get immediately productive in this repository by describing the
architecture, key files, developer workflows, conventions, and concrete examples for common changes.
make sure to update it every session (IMPORTANT) when you find soemthiinmg new
Big picture
-----------
- Two main components:
  - Kotlin Minecraft mod: `src/main/kotlin/club/sk1er/mods/levelhead` with resources in `src/main/resources`.
  - Backend proxy/service: a small TypeScript/Node service under `backend/` that proxies Hypixel calls,
    manages caching in PostgreSQL, exposes HTTP routes and Prometheus metrics.
- Monitoring and infra: `monitoring/` contains `docker-compose` for Prometheus + Grafana and dashboards.

Backend architecture
--------------------
- `backend/src/index.ts` wires Express with logging, health, metrics, cache purges, and graceful shutdown handlers.
- Routers:
  - `/api/public/player` (`routes/playerPublic.ts`) is rate-limited by `middleware/rateLimitPublic.ts` and returns cached payloads if available.
  - `/api/player` (`routes/player.ts`) is authenticated and layered over `services/player.ts`, `services/cache.ts`, and `services/hypixel.ts` to combine Hypixel/Mojang data.
  - `/api/admin` (`routes/admin.ts`) exposes cache control plus history via `middleware/adminAuth.ts`.
  - `/stats` (`routes/stats.ts`) exposes Prometheus metrics from `services/metrics.ts` and relies on `res.locals.metricsRoute` labels for logging.
- Services:
  - `services/cache.ts` bootstraps `player_cache`, `rate_limits`, and optional columns with idempotent migrations, then offers `getCacheEntry`, `setCachedPayload`, `purgeExpiredEntries`, and rate-limit helpers.
  - `services/hypixel.ts` wraps Hypixel calls with retries, timeouts, and instrumentation; `services/mojang.ts` resolves UUID/name pairs.
  - `services/history.ts` persists `player_query_history` entries for admin tooling and is purged by `purgeExpiredEntries`.

Where to look (key files)
-------------------------
- Repository build: `build.gradle.kts`, `root.gradle.kts`, `gradlew` (use the Gradle wrapper).
- Kotlin mod entrypoints: `src/main/kotlin/club/sk1er/mods/levelhead` and resources `src/main/resources/mcmod.info`, `mixins.levelhead.json`.
- Backend service root: `backend/` — important files:
  - `backend/package.json` (dev scripts)
  - `backend/src/index.ts` (Express app and route mounting)
  - `backend/src/config.ts` (required env vars and defaults)
  - `backend/src/services/*` (Hypixel, Mojang, cache, metrics)
  - `backend/src/routes/*` (API route definitions), `backend/src/middleware/*` (rate limiting, auth)
  - `backend/src/util/httpError.ts` defines typed HTTP errors the global handler returns.

Build & run (concrete commands)
------------------------------
- Build everything (from repo root):
  - `./gradlew build`
    - Produces mod build output under `versions/*/build/` and `build/` (normal Gradle output).
- Backend (development):
  - `cd backend`
  - `npm install`
  - `npm run dev` (uses `ts-node-dev` for hot-reload)
  - Production build: `npm run build` then `npm start` (runs `dist/index.js`).
- Monitoring (local):
  - `cd monitoring`
  - `docker compose up -d` or `docker-compose up -d`

Important environment variables (backend)
---------------------------------------
Defined in `backend/src/config.ts`. Required/important ones:
- `HYPIXEL_API_KEY` (required)
- `CACHE_DB_URL` (postgres connection string used by `backend/src/services/cache.ts`)
- `ADMIN_API_KEYS` (comma-separated admin keys)
- Optional tuning: `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX`, `CACHE_TTL_MS`, `PORT`, `HOST`, `TRUST_PROXY`.
- `HYPIXEL_API_BASE_URL` can point at Hypixel mirrors for testing, while `BUILD_SHA`/`GIT_REVISION`/`SOURCE_VERSION` feed into the outbound `Levelhead-Proxy/...` `User-Agent` header.
- `CACHE_DB_POOL_MIN`/`CACHE_DB_POOL_MAX` tune the Postgres pool in `services/cache.ts`; `TRUST_PROXY` accepts booleans, numbers, or strings to match Express `trust proxy` modes.

Codebase patterns & conventions
------------------------------
- Backend layering: `routes/*` define Express routers and delegate logic to `services/*`. Keep business logic in services.
- Middleware: reusable concerns (rate limiting, admin auth, public limits) live in `backend/src/middleware` and are applied to routers in `index.ts`.
- Cache: persistent cache lives in PostgreSQL (`player_cache`) with JSON `payload`, `etag`, and `last_modified` stored as bigint (ms). Use `backend/src/services/cache.ts` helpers (`getCacheEntry`, `setCachedPayload`, etc.).
- Metrics: Prometheus instrumentation is centralized in `backend/src/services/metrics.ts`. Routes set `res.locals.metricsRoute` so metrics use stable route labels.
- Errors: use `backend/src/util/httpError.ts` for controlled HTTP errors; global error handler in `index.ts` maps them to JSON responses.
- Kotlin mod: source code follows the package root `club.sk1er.mods.levelhead`; mixins and resource json files in `src/main/resources` are authoritative for runtime packaging.
- Cache purge job: `index.ts` calls `purgeExpiredEntries` on startup and every hour; it also prunes `player_query_history` and `rate_limits` so migrations can run without manual cleanup.
- History service: `services/history.ts` samples `player_query_history` entries for admins, so new data hooks need to align with the existing timestamp/payload schema.

Examples (common tasks)
-----------------------
- Add new backend API endpoint:
  1. Add business logic in `backend/src/services/<feature>.ts` (stateless helpers interacting with Hypixel/Mojang/cache).
  2. Add an Express router in `backend/src/routes/<feature>.ts` that imports the service and exposes routes.
  3. Mount the router in `backend/src/index.ts` (follow URL namespace conventions `/api/*` or `/api/public/*`).
  4. Add metrics label: set `res.locals.metricsRoute = '/yourroute'` before responding so route metrics are grouped.
  5. Run `cd backend && npm run dev` and exercise the endpoint.

- Use the cache helper:
  - `setCachedPayload(key, value, ttlMs, { etag, lastModified })` writes JSON payloads to `player_cache`.
  - `getCacheEntry<T>(key)` returns the stored payload and timestamps (returns null on miss/deserialization/expired).

Monitoring & metrics reminders
-----------------------------
- `monitoring/docker-compose.yml` brings up Prometheus (9090) and Grafana (3001) pre-configured with `monitoring/prometheus/prometheus.yml` and dashboard JSON files under `monitoring/grafana/provisioning`.
- Backend metrics are registered in `backend/src/services/metrics.ts`; `/stats` simply exposes the Prometheus registry, while `/metrics` is handled in `index.ts` with the `registry` content type.
- Hit `/healthz` during development—it pings Postgres via `cachePool.query('SELECT 1')` and `services/hypixel.ts` to determine whether the proxy is healthy or degraded.
Backend testing tips
--------------------
- There is no dedicated Jest or Kotlin unit test suite in the repo; rely on `./gradlew test` for Gradle validations and `cd backend && npm run build` for TypeScript type checking.
- When debugging backend flows, pay attention to structured logs (`[cache]`, `[request]`, `[hypixel]`) which indicate cache hits/misses, request durations, and Hypixel retry details.

PR & testing guidance
----------------------
- Before opening a PR, ensure you can build both components:
  - `./gradlew build` (root) and `cd backend && npm run build`.
- Run the backend locally with `npm run dev` and hit `/healthz` and `/metrics` to confirm the service boots and Postgres connection works.
- If your change affects metrics or new DB columns, update `backend/src/services/cache.ts` initialization logic carefully — the file contains idempotent migrations and logging patterns to follow.

Notes and gotchas
-----------------
- The backend expects a PostgreSQL instance for caching/metadata — many helper functions assume the `player_cache` schema exists and the code performs runtime schema adjustments.
- The repository contains prebuilt `versions/` outputs and build artifacts; don't edit files there — they are build outputs.
- Keep service code pure and side-effect free where possible: `services/*` are intended to be testable helpers.

If anything here is unclear or you want more examples (e.g., a template route/service or a Kotlin dev workflow), tell me what to expand and I'll update this file.
