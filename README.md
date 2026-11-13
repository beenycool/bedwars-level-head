# BedWars Levelhead

A Levelhead fork that shows BedWars (plus Duels/SkyWars) stats above players' heads and in
the tab list on Minecraft 1.8.9 Forge, with a small companion backend that holds one Hypixel
API key so the mod never needs a personal one.

## Requirements

- Minecraft 1.8.9 with Forge
- JDK 17 to build

The jar is self-contained: OneConfig is embedded, and **Essential is not required**. The render
path uses plain vanilla GL and the tab mixin uses a non-exclusive `@Inject`, so it coexists with
Patcher and other tab mods.

## Layout

| Path | Contents |
| --- | --- |
| `src/main/kotlin/` | Mod source (Minecraft 1.8.9 Forge) |
| `src/main/java/` | The single tab-list mixin |
| `build.gradle.kts` | Polyfrost defaults + Loom single-project build (Minecraft 1.8.9) |
| `backend/` | Express/TypeScript stats proxy (see `backend/README.md`) |
| `.github/workflows/` | CI: mod build, and backend image build + Render deploy |

## Building the mod

```sh
JAVA_HOME=/path/to/jdk17 ./gradlew --no-daemon build
```

The jar lands in `build/libs/`. Run the tests with `./gradlew test`
(they are headless — no game client needed).

## Commands

`/levelhead` opens the settings GUI. Chat subcommands:

| Command | Purpose |
| --- | --- |
| `/levelhead status` | Backend URL, cache state, last HTTP status and any active cooldown |
| `/levelhead reload` | Re-read settings and clear display caches |
| `/levelhead whois <player>` | Resolve a name/UUID and show its stats |

## Backend

```sh
cd backend
cp .env.example .env      # set HYPIXEL_API_KEY
npm ci
npm run dev               # or: npm run build && npm start
npm run typecheck         # tsc over src + tests
npm test                  # jest
```

`HYPIXEL_API_KEY` is the only required variable. `CACHE_DB_URL` is optional: without it the
service runs from an in-process cache and still serves data; with it, one PostgreSQL table
(`player_stats_cache`) keeps rows for 24 hours. Rate limiting is an in-process token bucket sized
for a full BedWars hub (`PUBLIC_RATE_LIMIT_MAX`, default 600 identifiers/minute). There is no
Redis, no dashboard and no `/metrics` endpoint.

## Deploy

- **Mod:** GitHub Actions builds `build/libs/*.jar` on push/release.
- **Backend:** `deploy-backend.yml` typechecks + tests, builds the Docker image, pushes it to
  GHCR and triggers the Render deploy described in `render.yaml` (starter plan, so the instance
  does not sleep).

## Tests

```sh
JAVA_HOME=/path/to/jdk17 ./gradlew --offline test          # mod, headless
cd backend && npm test                                     # backend, jest
```
