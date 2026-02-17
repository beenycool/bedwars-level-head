# Draft: Sumo stats cache shows Bedwars stars

## Problem Statement
- In Sumo (Duels), the first time a player is shown, their Duels division displays correctly (example: `Grandmaster`).
- The next time (after that game), the display shows **Bedwars stars** instead, likely because the player data is served from cache.
- Expected: for Sumo/Duels context, always show the **Duels division**, not Bedwars stars.

## Where It Shows Up
- Display location: **above the nametag** (in-world nameplate overlay).

## Repro Notes (confirmed)
- Happens in an active **Sumo match**.
- Second occurrence was against the **same opponent** as the first.

## User Config Signal (unconfirmed)
- User believes they are on default settings and that display config should not affect this behavior.

## Suspected Cause (hypothesis)
- Cache key is probably only `uuid` (or player name), not `(uuid + game-mode/stat-type)`.
- Or the render layer chooses “Bedwars” fields when a cached entry exists (stale/mismatched stat payload).

## Repo Recon (cache layer)
- Backend implements a multi-tier cache keyed as `player:{uuid}` (global per-player, not per-mode) in `backend/src/services/statsCache.ts`.
- Cached payload appears to be a normalized minimal stats object that includes both Bedwars + Duels numeric stats (so a mode mix-up can happen at render-time if the display caches a formatted string or uses the wrong mode context).

## Repo Recon (client overlay + mode routing)
- Game mode detection lives in `src/main/kotlin/club/sk1er/mods/levelhead/core/ModeManager.kt` (Bedwars/Duels/SkyWars/NONE).
- Display config is synced to detected mode via `src/main/kotlin/club/sk1er/mods/levelhead/core/DisplayManager.kt` `syncGameMode()`.
- Above-nametag rendering uses mode-specific stats formatting in `src/main/kotlin/club/sk1er/mods/levelhead/core/StatsFormatter.kt`.
- Stats are fetched + shaped per mode in `src/main/kotlin/club/sk1er/mods/levelhead/core/StatsFetcher.kt`.
- Client-side stats cache key includes BOTH uuid + game mode: `StatsCacheKey(val uuid: UUID, val gameMode: GameMode)` in `src/main/kotlin/club/sk1er/mods/levelhead/core/StatsRepository.kt`.

## Leading Hypothesis (based on code)
- The cached stats are separated by mode correctly, but the *mode used for cache lookup / display* can come from a stale `display.config.type` (resolved via `resolveGameMode(req.type)` in `src/main/kotlin/club/sk1er/mods/levelhead/core/RequestCoordinator.kt`).
- If `syncGameMode()` doesn’t run at the right time (or detectors briefly return NONE), the display config can effectively default to Bedwars, causing the above-nametag line to show Bedwars stars during a Duels/Sumo context.

## Test Infra (FYI)
- Backend has Jest config in `backend/jest.config.js` but very limited existing tests; client mod appears to have no unit tests configured.

## Requirements (known)
- Must display Duels division for Sumo/Duels consistently, including when data is returned from cache.

## Open Questions
- What exact strings are shown in both cases (copy/paste)?
- What exactly is the mode signal used by the app to decide “Sumo vs Bedwars”? (game type, lobby, API field, etc.)
- Cache expectations: per-session only, TTL-based, or persistent between runs?
- When Bedwars stars appear, are you in an active Sumo match, in the pregame cage/arena, or back in a lobby?

## Scope Boundaries (tentative)
- INCLUDE: cache scoping / invalidation, correct stat selection for Sumo/Duels.
- EXCLUDE (unless requested): redesign of formatting, adding new stats, major refactor of caching subsystem.
