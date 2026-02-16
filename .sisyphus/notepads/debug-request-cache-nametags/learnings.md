# Learnings

- (none yet)

## 2026-02-16: Debug Toggles Implementation

Added two new OneConfig debug toggles following the existing `debugConfigSync` pattern:

- `debugRequests`: Logs HTTP requests/responses to latest.log for API troubleshooting
- `debugRenderSampling`: Logs render timing and sampling decisions to latest.log

Pattern used:
- `@Switch` annotation with `name`, `description`, `category = "Advanced"`
- Private var with custom setter that calls `save()`
- Reset to `false` in `resetToDefaults()` function
- Display in `/levelhead debug` using `formatToggle(LevelheadConfig.xxx)`

## 2026-02-16: Request-Origin Plumbing

Added `RequestReason` enum and `reason` parameter to `LevelheadRequest` to track why requests are made for logging/debugging purposes.

Implementation:
- Added `RequestReason` enum with variants: `PLAYER_JOIN`, `REQUEST_ALL_DISPLAYS`, `REFRESH_VISIBLE_DISPLAYS`, `TAB_LIST`, `UNKNOWN`
- Added `reason` parameter to `LevelheadRequest` data class with default value `RequestReason.UNKNOWN` for backward compatibility
- Updated call sites in `DisplayManager.kt` to pass specific reasons:
  - `playerJoin()` → `PLAYER_JOIN`
  - `requestAllDisplays()` → `REQUEST_ALL_DISPLAYS`
  - `refreshVisibleDisplays()` → `REFRESH_VISIBLE_DISPLAYS`
- Updated `MixinGuiPlayerTabOverlay.java` to pass `TAB_LIST` (explicit because Kotlin default params don't work from Java)

Key insight: Kotlin default parameters require `@JvmOverloads` annotation to work from Java, but using a default value is simpler here - the Java call site already has all parameters so we explicitly pass the reason.

## 2026-02-16: Shared Debug Logging Helpers

Created `src/main/kotlin/club/sk1er/mods/levelhead/core/DebugLogging.kt` with allocation-light helpers:

- `isRequestDebugEnabled()`: Gates checks using `LevelheadConfig.debugRequests`
- `isRenderDebugEnabled()`: Gates checks using `LevelheadConfig.debugRenderSampling`
- `Color.formatAsHex()`: Formats color as `#RRGGBB` (uppercase)
- `String.truncateForLogs(maxLength)`: Safely truncates strings, handling `§` and `✪` special chars
- `UUID.maskForLogs()`: Privacy-safe masking, keeps last 4 chars (e.g., `****-abcd`)
- `String.maskIfUuid()`: Masks string if valid UUID, otherwise returns as-is
- `logRequestDebug { }`: Conditional request debug logging (lazy string building)
- `logRenderDebug { }`: Conditional render debug logging (lazy string building)
- `String.sanitizeAndTruncateForLogs()`: Combines sanitizeForLogs() + truncate

Call sites added:
- `LevelheadCommand.kt`: Added helper status display showing `isRequestDebugEnabled()` and `isRenderDebugEnabled()`
- `AboveHeadRender.kt`: Changed `maybeLogSelfHidden()` to use `DebugLogging.isRenderDebugEnabled()` + `logRenderDebug()`

Key design decisions:
- Lazy string building via lambdas to avoid allocation when debug is disabled
- Special handling for § (Minecraft color codes) and ✪ (star symbols) in truncation
- Reuses existing `BedwarsHttpUtils.sanitizeForLogs()` for redaction

## 2026-02-16: Scope Compliance Cleanup

Removed scope creep from DebugLogging integration (Task 2):

- **LevelheadCommand.kt**: Removed "(helper active: ...)" suffix from `/levelhead debug` output. The debug toggle states are now shown without extra helper status.
- **AboveHeadRender.kt**: Restored original `maybeLogSelfHidden()` behavior:
  - Gated by `LevelheadConfig.debugConfigSync` (not DebugLogging helper)
  - Logs via `Levelhead.logger.info(...)` with exact message format: `"[LevelheadRender] skipping self tag (showSelf=false, displayPosition={}, offset={})"`
  - Kept 2-second throttle logic

Removed unused imports:
- `import club.sk1er.mods.levelhead.core.DebugLogging` from both files

Rationale: DebugLogging helpers are reserved for Tasks 4-8. Debug output in the command and render should remain unchanged from pre-DebugLogging behavior.

## 2026-02-16: Restore Placeholder Logging

- Restored `maybeLogSelfHidden()` to use `{}` placeholders with args (log4j style) instead of string interpolation. This avoids eager string building when debug logging is disabled.

## 2026-02-16: Guarding Expensive Debug Computations

Fixed Task 4 acceptance issue in `Levelhead.kt` - `fetchBatch()` method:

Problem: `reasons` (Set mapping), `maskedUuid` (string creation), and `trimmedMasked` (conditional string) were computed unconditionally even when debug logging was disabled.

Solution: Added `val debug = DebugLogging.isRequestDebugEnabled()` check at the start of each gameMode loop iteration, then made the three debug-only values compute conditionally:

```kotlin
val debug = DebugLogging.isRequestDebugEnabled()
val reasons = if (debug) modeRequests.map { it.reason }.toSet() else null
val maskedUuid = if (debug) "****-${uuid.toString().takeLast(4)}" else null
val trimmedMasked = if (debug) (if (trimmedUuid.length == 32) "****-${trimmedUuid.takeLast(4)}" else trimmedUuid) else null
```

Key insight: Even though `logRequestDebug { }` uses lazy string building via lambdas, the values passed to those lambdas were being computed BEFORE the lambda was passed. Now computation is gated by the debug flag.

## 2026-02-16: Hypixel Request Debug Logging

Added debug logging to `HypixelClient.kt` for direct Hypixel API requests (the fallback path when not using the proxy):

Implementation:
- Request start log: `[LevelheadDebug][network] request start: endpoint=..., uuid=****-xxxx, hasApiKey=true/false`
- Response log: `[LevelheadDebug][network] response: status=200, bodyLength=1234` (or `status=304 (Not Modified)`)
- Parse log: `[LevelheadDebug][network] parse: success=true` or `success=false, error=JsonSyntaxException`
- Error log: `[LevelheadDebug][network] error: IOException`

Key design decisions:
- Gated by `DebugLogging.isRequestDebugEnabled()` check before computing masked UUID
- Uses lazy string building via `logRequestDebug { }` to avoid allocation when debug disabled
- API key presence logged as boolean only (never the actual key value)
- Body length logged but not the body content itself
- Endpoint path logged but query params (uuid) is masked to `****-xxxx` format

## 2026-02-16: Tag-Write Logging Location

Added tag-write debug logging in `Levelhead.kt` - `updateDisplayCache()` method.

Implementation:
- Prefix: `[LevelheadDebug][tag]`
- Logged when `LevelheadConfig.debugRequests` is ON
- Uses `DebugLogging.logRequestDebug { }` with lazy string building
- Contents: masked uuid (`****-abcd`), gameMode, tag string (truncated to 200 chars), header value + hex color, footer value + hex color

Key design decisions:
- Gated by `DebugLogging.logRequestDebug { }` to avoid building strings when debug is disabled
- Uses existing helper functions: `UUID.maskForLogs()`, `String.truncateForLogs(Int)`, `Color.formatAsHex()`
- Tag string truncated to 200 chars via `truncateForLogs(200)` to avoid log spam
- Header/footer values truncated to 50 chars each for compactness

## 2026-02-16: Render Sampling Logs (Throttled)

Added throttled render debug logging in `AboveHeadRender.kt` for sampling what gets rendered for each player.

Implementation:
- Per-player UUID throttling using `ConcurrentHashMap<UUID, Long>`: max once per 2000ms per player
- Gated by `DebugLogging.isRenderDebugEnabled()` (checks `LevelheadConfig.debugRenderSampling`)
- Uses lazy string building via `DebugLogging.logRenderDebug { }` to avoid allocation when debug disabled
- Log prefix: `[LevelheadDebug][render]`
- Contents: player name, masked uuid (`****-abcd`), tag string (truncated to 200 chars), header value + hex color, footer value + hex color, display position, computed y offset

Key design decisions:
- Throttling map uses `ConcurrentHashMap` for thread-safety (render events fire from render thread)
- Log only fires when tag is about to be rendered (`tag != null` condition already satisfied)
- No string building when debug disabled (early return + lazy lambda)
- Extension functions imported explicitly: `maskForLogs`, `truncateForLogs`, `formatAsHex`, `logRenderDebug`

