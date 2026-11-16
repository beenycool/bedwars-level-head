# BedWars Levelhead

A Levelhead fork for Minecraft 1.8.9 (Forge) that shows BedWars, Duels and SkyWars stats above players' heads and in the tab list.

Stats come from a small companion backend that holds a single Hypixel API key, so players never need their own.

## Highlights

- Stats above nametags and in the tab list
- No personal Hypixel API key needed
- Self-contained jar: OneConfig is embedded and Essential is **not** required
- Compatible with Patcher and other tab mods (rendering uses plain vanilla GL, and the tab mixin is a non-exclusive `@Inject`)

## Requirements

- Minecraft 1.8.9 with Forge
- JDK 17 (to build)

## Repository layout

| Path | Contents |
| --- | --- |
| `src/main/kotlin/` | Mod source |
| `src/main/java/` | The single tab-list mixin |
| `build.gradle.kts` | Polyfrost defaults and Loom single-project build |
| `backend/` | Express/TypeScript stats proxy (see `backend/README.md`) |
| `.github/workflows/` | CI for the mod build and for the backend image build and Render deploy |

## Mod

### Build

```sh
JAVA_HOME=/path/to/jdk17 ./gradlew --no-daemon build
```

The jar is written to `build/libs/`.

### Commands

`/levelhead` opens the settings GUI. Chat subcommands:

| Command | Purpose |
| --- | --- |
| `/levelhead status` | Show the backend URL, cache state, last HTTP status and any active cooldown |
| `/levelhead reload` | Re-read settings and clear display caches |
| `/levelhead whois <player>` | Resolve a name or UUID and show its stats |

## Backend

### Run locally

```sh
cd backend
cp .env.example .env      # then set HYPIXEL_API_KEY
npm ci
npm run dev               # or: npm run build && npm start
```

### Check

```sh
npm run typecheck         # tsc over src
```

### Configuration

| Variable | Required | Purpose |
| --- | --- | --- |
| `HYPIXEL_API_KEY` | Yes | The shared Hypixel API key |
| `CACHE_DB_URL` | No | PostgreSQL connection. Without it, the service uses an in-process cache and still works. With it, the `player_stats_cache` table keeps rows for 24 hours |
| `PUBLIC_RATE_LIMIT_MAX` | No | Hard ceiling for the dynamic per-IP token bucket. Default: 600 identifiers per minute |
| `PUBLIC_REQUEST_LIMIT_MAX` | No | Fixed per-IP request guard for cached traffic. Default: 1,200 requests per minute |

The per-IP identifier budget is dynamic: it scales between 20 and 600 identifiers per minute
from the remaining Hypixel quota, active clients and the cache hit rate. Tune it with
`DYNAMIC_RATE_LIMIT_MIN`, `DYNAMIC_RATE_LIMIT_MAX` and `HYPIXEL_HOURLY_QUOTA`, or set
`DYNAMIC_RATE_LIMIT_ENABLED=false` for a flat `PUBLIC_RATE_LIMIT_MAX` budget.

Cache hits refund their identifier cost, so cached lookups are free against that budget. Every
HTTP request still counts against the separate `PUBLIC_REQUEST_LIMIT_MAX` guard.

The backend has no Redis dependency, no external dashboard and no `/metrics` endpoint; `/stats`
is rendered by the service itself.

## Deployment

- **Mod:** GitHub Actions builds `build/libs/*.jar` on push and on release.
- **Backend:** `deploy-backend.yml` typechecks, builds the Docker image, pushes it to GHCR, then triggers the Render deploy defined in `render.yaml`. It uses the starter plan so the instance does not sleep.
