# Draft: Debug Logging for Requests, Cache Warmth, Nametags

## Original Request (verbatim)
- "add debug loggin so we can see when a request was made adn why, what it recieved and if its warm from cache or not and what its currently showing on the nametags and what colour"

## Working Interpretation
- Add structured debug logging around the code path that makes external/internal requests to fetch player/state data.
- Log: when a request is made, why it was made (trigger/reason), what response was received (sanitized), whether served from cache (warm/hit) vs fetched (cold/miss), and what the system is currently rendering on nametags (text + computed color).

## Requirements (confirmed)
- Scope: Mod/client logging only (no backend/proxy server changes).
- Verbosity: Requests + tag updates, plus render sampling (throttled).
- Automated tests: Skip.

## Codebase Findings (mod/client)
- Requests are triggered from `src/main/kotlin/club/sk1er/mods/levelhead/core/DisplayManager.kt`:
  - `joinWorld()` calls `requestAllDisplays()` when in-game.
  - `playerJoin()` enqueues requests for players missing `display.cache[player.uniqueID]`.
  - `tick()` drains `pendingRequests` and calls `Levelhead.fetchBatch(batch)`.
- Local cache decision happens in `src/main/kotlin/club/sk1er/mods/levelhead/Levelhead.kt`:
  - `fetchBatch()` groups requests per player + game mode and checks `statsCache[StatsCacheKey]`.
  - Cache outcomes are explicit: `cached == null` (cold miss), `cached.isExpired(...)` (expired; tag still applied + refresh queued), else (warm hit; no network).
  - Network fetch paths:
    - Proxy batch: `ProxyClient.fetchBatch(chunk)` when `LevelheadConfig.proxyEnabled`.
    - Fallback per-player fetch: `ensureStatsFetch(...)->StatsFetcher.fetchPlayer(...)`.
- Upstream request execution:
  - Proxy: `src/main/kotlin/club/sk1er/mods/levelhead/bedwars/ProxyClient.kt` (OkHttp). It already reads `X-Cache` and computes `isCacheHit` but does not currently log it.
  - Hypixel direct: `src/main/kotlin/club/sk1er/mods/levelhead/bedwars/HypixelClient.kt` (OkHttp) with minimal logging.
  - Request retry + log sanitization helpers exist in `src/main/kotlin/club/sk1er/mods/levelhead/bedwars/BedwarsHttpUtils.kt` (`sanitizeForLogs()`, `executeWithRetries()`).
- Nametag text + color are computed in `src/main/kotlin/club/sk1er/mods/levelhead/core/StatsFormatter.kt`:
  - `formatTag()` builds `LevelheadTag` with `header.value`, `header.color`, `footer.value`, `footer.color`.
  - Footer color is often derived from prestige style (`BedwarsStar.styleForStar`) and can be forced gray for stale data.
- The final rendered output is drawn in `src/main/kotlin/club/sk1er/mods/levelhead/render/AboveHeadRender.kt`:
  - Uses `display.cache[player.uniqueID]` and renders `tag.header.value/tag.footer.value` with `component.color`.
  - Has an existing throttled info log gated by `LevelheadConfig.debugConfigSync` (`maybeLogSelfHidden()`).
- Tag write point (good place to log "currently showing"):
  - `src/main/kotlin/club/sk1er/mods/levelhead/Levelhead.kt` `updateDisplayCache()` creates the tag and writes `display.cache[uuid] = tag`.

## Codebase Findings (backend/proxy server)
- There is also a Node backend under `backend/` with its own request/caching + metrics:
  - `backend/src/routes/player.ts`, `backend/src/services/player.ts`, `backend/src/services/statsCache.ts`, `backend/src/services/hypixel.ts`.
  - Cache tiers L1 Redis + L2 SQL; history tables already track `cache_source` and `cache_hit`.
  - If you want server-side request debugging too, it likely belongs behind an env flag (e.g. `DEBUG_REQUEST_LOGGING`).

## Proposed Debug Fields (initial)
- Request context: timestamp, uuid/identifier (sanitized), gameMode, trigger reason (playerJoin/tick/refresh/manual), localCacheStatus (hit/miss/expired).
- Network result: source (proxy vs hypixel), HTTP status, error reason, ETag/304 revalidation, proxy `X-Cache` (HIT/PARTIAL/MISS).
- Rendered state: tag string (`tag.getString()`), header/footer values, header/footer colors (RGB/hex).

## Open Questions
- Where should logs go? console/stdout, plugin logger, file, or both?
- Should debug logging be always-on, or behind a config flag / env var / command?
- Any PII/secrets to redact (player names/UUIDs, tokens, headers, full payloads)?

## Notes
- The mod already uses Log4j via `Levelhead.logger`. Many existing logs are at `debug` level; depending on runtime log level, new debug logs may be invisible unless we either (a) emit gated `info` logs, or (b) instruct users to raise log level.

## Scope Boundaries (initial)
- INCLUDE: request + cache + nametag render state logging.
- EXCLUDE (unless requested): changing caching behavior, changing nametag visuals, adding new telemetry backend.
