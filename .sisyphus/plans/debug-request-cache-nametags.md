# Debug Logging for Requests, Cache Warmth, and Nametag Output

## TL;DR

> Quick Summary: Add opt-in (default OFF) debug logging to the Minecraft mod to explain *when* stat requests happen, *why* they happen, what came back, whether it was warm from cache (local + proxy `X-Cache`), and what the mod is currently showing on nametags (text + colors), with throttled render sampling.
>
> Deliverables:
> - OneConfig toggles to enable debug request logs + debug render sampling
> - Structured log lines for request trigger, cache decision, network response summary, tag write, and render sampling
> - Safe redaction and log-volume guardrails
>
> Estimated Effort: Medium
> Parallel Execution: YES (3 waves)
> Critical Path: Debug toggles + helpers -> request/cache/network logs -> tag + render logs -> verification

---

## Context

### Original Request
Add debug logging so we can see:
- when a request was made and why
- what it received
- whether it was warm from cache or not
- what is currently showing on nametags and what color

### Interview Summary (decisions)
- Scope: mod/client only (no changes in `backend/`)
- Verbosity: requests + tag updates, plus render sampling (throttled)
- Automated tests: skip

### Codebase Map (key references)
- Request triggers + batching:
  - `src/main/kotlin/club/sk1er/mods/levelhead/core/DisplayManager.kt` (enqueue + tick + requestAllDisplays + refreshVisibleDisplays)
  - `src/main/kotlin/club/sk1er/mods/levelhead/Levelhead.kt` (`fetchBatch`, `ensureStatsFetch`)
- Local cache and tag write:
  - `src/main/kotlin/club/sk1er/mods/levelhead/Levelhead.kt` (`statsCache` + `updateDisplayCache`)
- Network:
  - `src/main/kotlin/club/sk1er/mods/levelhead/bedwars/ProxyClient.kt` (reads `X-Cache` header)
  - `src/main/kotlin/club/sk1er/mods/levelhead/bedwars/HypixelClient.kt`
  - `src/main/kotlin/club/sk1er/mods/levelhead/bedwars/BedwarsHttpUtils.kt` (`sanitizeForLogs()`)
- Tag formatting + color:
  - `src/main/kotlin/club/sk1er/mods/levelhead/core/StatsFormatter.kt`
  - `src/main/kotlin/club/sk1er/mods/levelhead/display/LevelheadTag.kt`
- Rendering (above-head):
  - `src/main/kotlin/club/sk1er/mods/levelhead/render/AboveHeadRender.kt`
- Existing debug toggle pattern:
  - `src/main/kotlin/club/sk1er/mods/levelhead/config/LevelheadConfig.kt` (`debugConfigSync`)
  - `src/main/kotlin/club/sk1er/mods/levelhead/commands/LevelheadCommand.kt` (`/levelhead debug`)

### Metis Review (guardrails applied)
- Do NOT log secrets (API keys, proxy tokens) or auth headers; avoid logging full JSON bodies.
- Avoid log spam/perf regressions: throttle + dedupe + avoid heavy string building unless enabled.
- Make logs visible in `latest.log` without requiring log level changes: use gated `logger.info` (not only `logger.debug`).
- Treat proxy `X-Cache` header as optional (`<absent>`).
- Avoid scope creep: do not refactor request flow, cache TTL logic, or backend.

---

## Work Objectives

### Core Objective
When debug logging is enabled, the mod emits enough context in `latest.log` to explain the full chain:
trigger -> cache decision -> network response -> tag computed -> tag written -> sampled render.

### Concrete Deliverables
- New OneConfig switches (default OFF):
  - `Debug Requests` (request/cache/network/tag-write logs)
  - `Debug Render Sampling` (throttled logs of what is being rendered)
- Log markers/prefixes (stable, grep-friendly), e.g.:
  - `[LevelheadDebug][request] ...`
  - `[LevelheadDebug][cache] ...`
  - `[LevelheadDebug][network] ...`
  - `[LevelheadDebug][tag] ...`
  - `[LevelheadDebug][render] ...`

### Must NOT Have (guardrails)
- No logging of `API-Key` or `Authorization` header values.
- No logging of full response bodies.
- No per-frame unthrottled render logs.
- No changes under `backend/`.

---

## Verification Strategy

### Test Decision
- Infrastructure exists: NO (no `src/test` and no test deps in `build.gradle.kts`)
- Automated tests: None (per user decision)

### QA Policy
Agent-executed verification only.
- Primary: build + static greps to confirm instrumentation exists and is gated by config.
- Secondary: optional runtime verification steps described, but not required for plan completion.

Evidence files should be saved by the executor under:
- `.sisyphus/evidence/task-*-*.txt`

---

## Execution Strategy

### Parallel Execution Waves

Wave 1 (foundation, unblock others)
1. Add dedicated debug toggles in config (and surface in `/levelhead debug`).
2. Add a small debug logging helper (formatting, UUID/name formatting, hex color formatting, safe truncation).
3. Add request-origin plumbing (`reason` field) so logs can answer "why".

Wave 2 (core instrumentation, can run mostly in parallel after Wave 1)
4. Local cache decision + request batching logs in `Levelhead.fetchBatch` / `ensureStatsFetch`.
5. Proxy network logs in `ProxyClient` including `X-Cache` and status.
6. Hypixel network logs in `HypixelClient` including status.
7. Tag-write logs in `updateDisplayCache` including final text + header/footer colors.
8. Render sampling logs in `AboveHeadRender` (throttled).

Wave 3 (verification + polish)
9. Tighten redaction + ensure all debug logs are gated + add grep-friendly prefixes.
10. Verification commands + evidence capture instructions.

---

## Dependency Matrix (abbreviated)

| Task | Depends On | Blocks |
|------|------------|--------|
| 1 | - | 4-8 |
| 2 | - | 4-8 |
| 3 | - | 4 |
| 4 | 1,2,3 | 9 |
| 5 | 1,2 | 9 |
| 6 | 1,2 | 9 |
| 7 | 1,2 | 9 |
| 8 | 1,2 | 9 |
| 9 | 4-8 | 10 |
| 10 | 9 | FINAL |

---

## TODOs

- [ ] 1. Add debug toggles to config and expose in `/levelhead debug`

  What to do:
  - Add new OneConfig switches under Advanced in `src/main/kotlin/club/sk1er/mods/levelhead/config/LevelheadConfig.kt`.
  - Ensure defaults are OFF.
  - Extend `/levelhead debug` output in `src/main/kotlin/club/sk1er/mods/levelhead/commands/LevelheadCommand.kt` to show these toggles.

  Must NOT do:
  - Do not reuse `debugConfigSync` for request/render logging (keep responsibilities separate).

  Recommended Agent Profile:
  - Category: quick
  - Skills: (none)

  Parallelization:
  - Can Run In Parallel: YES (with Task 2)
  - Blocks: Tasks 4-8

  References:
  - `src/main/kotlin/club/sk1er/mods/levelhead/config/LevelheadConfig.kt` (existing `debugConfigSync` switch style)
  - `src/main/kotlin/club/sk1er/mods/levelhead/commands/LevelheadCommand.kt` (`debug()` command output)

  Acceptance Criteria:
  - New switches appear in OneConfig under Advanced and default to OFF.
  - `/levelhead debug` includes lines indicating debug request/render sampling enabled state.

  QA Scenarios:
  ```text
  Scenario: Build compiles after adding toggles
    Tool: Bash
    Steps:
      1. Run: ./gradlew build
      2. Capture output to: .sisyphus/evidence/task-1-gradle-build.txt
    Expected Result: Exit code 0
  ```

- [ ] 2. Add shared debug logging helpers (format + redaction-safe summary)

  What to do:
  - Create a small helper (new Kotlin file) to:
    - Format colors as `#RRGGBB` from `java.awt.Color`.
    - Truncate long strings safely.
    - Format UUIDs consistently (recommend: trimmed 32-char UUID).
    - Centralize gating checks (`LevelheadConfig.debugRequests`, `LevelheadConfig.debugRenderSampling`).
  - Ensure any string derived from URLs or JSON is passed through `sanitizeForLogs()` when applicable.

  Must NOT do:
  - Do not allocate heavy strings or parse JSON just for logging unless debug is enabled.

  Recommended Agent Profile:
  - Category: quick
  - Skills: (none)

  Parallelization:
  - Can Run In Parallel: YES (with Task 1)
  - Blocks: Tasks 4-8

  References:
  - `src/main/kotlin/club/sk1er/mods/levelhead/bedwars/BedwarsHttpUtils.kt` (`sanitizeForLogs()`)
  - `src/main/kotlin/club/sk1er/mods/levelhead/display/LevelheadTag.kt` (data model for tag values/colors)

  Acceptance Criteria:
  - Helper is used by at least 2 call sites (so format stays consistent).

  QA Scenarios:
  ```text
  Scenario: Helper is present and referenced
    Tool: Bash
    Steps:
      1. Run: grep -R "\[LevelheadDebug\]" -n src/main/kotlin/club/sk1er/mods/levelhead | tee .sisyphus/evidence/task-2-debug-grep.txt
    Expected Result: At least one match in a helper file and at least one match in a call site.
  ```

- [ ] 3. Add request-origin plumbing so logs can answer "why"

  What to do:
  - Add a `reason` field (string or enum) to `Levelhead.LevelheadRequest` in `src/main/kotlin/club/sk1er/mods/levelhead/Levelhead.kt`.
  - Populate it from enqueue sites in `src/main/kotlin/club/sk1er/mods/levelhead/core/DisplayManager.kt`:
    - `playerJoin()` -> reason `playerJoin`
    - `requestAllDisplays()` -> reason `requestAllDisplays`
    - `refreshVisibleDisplays()` -> reason `refreshVisibleDisplays`
  - Ensure `fetchBatch()` can aggregate reasons when grouped per uuid.

  Must NOT do:
  - Do not change behavior of queueing/batching beyond adding metadata.

  Recommended Agent Profile:
  - Category: quick
  - Skills: (none)

  Parallelization:
  - Can Run In Parallel: YES (with Task 1-2)
  - Blocks: Task 4

  References:
  - `src/main/kotlin/club/sk1er/mods/levelhead/core/DisplayManager.kt` (enqueue sites)
  - `src/main/kotlin/club/sk1er/mods/levelhead/Levelhead.kt` (`LevelheadRequest` data class)

  Acceptance Criteria:
  - Each enqueue path sets a non-empty reason.

  QA Scenarios:
  ```text
  Scenario: Reason field is wired end-to-end (static verification)
    Tool: Bash
    Steps:
      1. Run: grep -R "LevelheadRequest(" -n src/main/kotlin/club/sk1er/mods/levelhead/core/DisplayManager.kt | tee .sisyphus/evidence/task-3-reason-sites.txt
      2. Run: grep -R "data class LevelheadRequest" -n src/main/kotlin/club/sk1er/mods/levelhead/Levelhead.kt | tee -a .sisyphus/evidence/task-3-reason-sites.txt
    Expected Result: Request constructors include the reason parameter and the data class contains it.
  ```

- [ ] 4. Log local cache decisions and request batching in `fetchBatch` / `ensureStatsFetch`

  What to do:
  - In `src/main/kotlin/club/sk1er/mods/levelhead/Levelhead.kt`:
    - When grouped requests are processed, log local cache state per uuid+mode: HIT/MISS(EXPIRED/COLD).
    - When a network fetch is initiated, log why (cold miss vs expired refresh) + request reason(s).
    - When fallback is skipped (`shouldSkipFallback`), log the decision.
  - Ensure logs are gated by `LevelheadConfig.debugRequests`.

  Must NOT do:
  - Do not change cache TTL logic.

  Recommended Agent Profile:
  - Category: quick
  - Skills: (none)

  Parallelization:
  - Can Run In Parallel: YES (with Tasks 5-8)
  - Blocked By: Tasks 1-3

  References:
  - `src/main/kotlin/club/sk1er/mods/levelhead/Levelhead.kt` (`fetchBatch`, `ensureStatsFetch`, `shouldSkipFallback`)

  Acceptance Criteria:
  - All new log lines include the `[LevelheadDebug]` prefix and a category (`[cache]`, `[request]`).
  - Logs are only emitted when `debugRequests` is enabled.

  QA Scenarios:
  ```text
  Scenario: Build compiles and debug log markers are present
    Tool: Bash
    Steps:
      1. Run: ./gradlew build
      2. Run: grep -R "\[LevelheadDebug\]" -n src/main/kotlin/club/sk1er/mods/levelhead/Levelhead.kt | tee .sisyphus/evidence/task-4-log-markers.txt
    Expected Result: Build passes; grep finds new markers.
  ```

- [ ] 5. Add proxy request/response debug logs (include `X-Cache`)

  What to do:
  - In `src/main/kotlin/club/sk1er/mods/levelhead/bedwars/ProxyClient.kt`:
    - Log when a proxy request is made (endpoint, identifier/uuid, conditional headers present).
    - Log response summary: status, `X-Cache` header (HIT/PARTIAL/MISS/<absent>), ETag presence, body length, success/failure.
    - For `FetchResult.NotModified`, log `304 Not Modified` explicitly.
  - Gate with `LevelheadConfig.debugRequests`.
  - Redaction rules: do not print bearer token; use `sanitizeForLogs()` when printing base URLs or body snippets.

  Recommended Agent Profile:
  - Category: quick

  Parallelization:
  - Can Run In Parallel: YES (with Tasks 4,6-8)
  - Blocked By: Tasks 1-2

  References:
  - `src/main/kotlin/club/sk1er/mods/levelhead/bedwars/ProxyClient.kt` (`X-Cache` parsing already present)
  - `src/main/kotlin/club/sk1er/mods/levelhead/bedwars/BedwarsHttpUtils.kt` (`sanitizeForLogs()`)

  Acceptance Criteria:
  - Proxy logs include `X-Cache=<value>` (or `<absent>`).

  QA Scenarios:
  ```text
  Scenario: No auth headers are logged (static grep)
    Tool: Bash
    Steps:
      1. Run: grep -nE "logger\.(info|debug|warn|error)\(.*(Authorization|Bearer)" src/main/kotlin/club/sk1er/mods/levelhead/bedwars/ProxyClient.kt | tee .sisyphus/evidence/task-5-auth-grep.txt
    Expected Result: No matches (empty file) because auth headers/tokens are never printed.
  ```

- [ ] 6. Add Hypixel request/response debug logs

  What to do:
  - In `src/main/kotlin/club/sk1er/mods/levelhead/bedwars/HypixelClient.kt`:
    - Log when a Hypixel request is attempted (uuid, endpoint) and whether API key is present (boolean only).
    - Log response summary: status, body length, parse success/failure.
  - Gate with `LevelheadConfig.debugRequests`.

  Recommended Agent Profile:
  - Category: quick

  Parallelization:
  - Can Run In Parallel: YES (with Tasks 4-5,7-8)
  - Blocked By: Tasks 1-2

  References:
  - `src/main/kotlin/club/sk1er/mods/levelhead/bedwars/HypixelClient.kt`

  Acceptance Criteria:
  - No API key values are ever logged.

  QA Scenarios:
  ```text
  Scenario: Static check for API key logging
    Tool: Bash
    Steps:
      1. Run: grep -nE "logger\.(info|debug|warn|error)\(.*API-Key" src/main/kotlin/club/sk1er/mods/levelhead/bedwars/HypixelClient.kt | tee .sisyphus/evidence/task-6-api-key-grep.txt
    Expected Result: No matches (empty file) because API key values are never printed.
  ```

- [ ] 7. Add tag-write logs (what is currently shown + colors)

  What to do:
  - In `src/main/kotlin/club/sk1er/mods/levelhead/Levelhead.kt` `updateDisplayCache()`:
    - After `StatsFormatter.formatTag(...)`, log:
      - `tag.getString()`
      - `tag.header.value`, `tag.footer.value`
      - header/footer colors as hex (`#RRGGBB`)
      - gameMode + uuid
  - Gate with `LevelheadConfig.debugRequests`.

  Recommended Agent Profile:
  - Category: quick

  Parallelization:
  - Can Run In Parallel: YES (with Tasks 4-6,8)
  - Blocked By: Tasks 1-2

  References:
  - `src/main/kotlin/club/sk1er/mods/levelhead/Levelhead.kt` (`updateDisplayCache`)
  - `src/main/kotlin/club/sk1er/mods/levelhead/core/StatsFormatter.kt` (how footer color is chosen)
  - `src/main/kotlin/club/sk1er/mods/levelhead/render/AboveHeadRender.kt` (render uses component colors)

  Acceptance Criteria:
  - Tag log includes both header and footer colors.

  QA Scenarios:
  ```text
  Scenario: Tag log marker exists
    Tool: Bash
    Steps:
      1. Run: grep -R "\[LevelheadDebug\]\[tag\]" -n src/main/kotlin/club/sk1er/mods/levelhead/Levelhead.kt | tee .sisyphus/evidence/task-7-tag-marker.txt
    Expected Result: At least one match.
  ```

- [ ] 8. Add render sampling logs (throttled)

  What to do:
  - In `src/main/kotlin/club/sk1er/mods/levelhead/render/AboveHeadRender.kt`:
    - When `tag != null` and render will happen, emit a throttled log line of what is being rendered:
      - player name + uuid
      - tag string + header/footer colors
    - Implement throttling keyed by uuid with a minimum interval (recommend 2s).
    - Gate with `LevelheadConfig.debugRenderSampling`.

  Must NOT do:
  - Do not log every frame.

  Recommended Agent Profile:
  - Category: quick

  Parallelization:
  - Can Run In Parallel: YES (with Tasks 4-7)
  - Blocked By: Tasks 1-2

  References:
  - `src/main/kotlin/club/sk1er/mods/levelhead/render/AboveHeadRender.kt` (`maybeLogSelfHidden()` shows existing throttled logging pattern)

  Acceptance Criteria:
  - Render sampling logs are throttled and gated behind `debugRenderSampling`.

  QA Scenarios:
  ```text
  Scenario: Render sampling log marker exists and is gated
    Tool: Bash
    Steps:
      1. Run: grep -R "debugRenderSampling" -n src/main/kotlin/club/sk1er/mods/levelhead/render/AboveHeadRender.kt | tee .sisyphus/evidence/task-8-render-gating.txt
      2. Run: grep -R "\[LevelheadDebug\]\[render\]" -n src/main/kotlin/club/sk1er/mods/levelhead/render/AboveHeadRender.kt | tee -a .sisyphus/evidence/task-8-render-gating.txt
    Expected Result: Both matches exist.
  ```

- [ ] 9. Hardening pass: ensure gating + redaction + stable prefixes everywhere

  What to do:
  - Verify every new log line is behind the correct toggle.
  - Ensure all log lines use the stable `[LevelheadDebug]` prefix and category tags.
  - Ensure no accidental logging of headers/payloads.
  - Consider truncation for tag strings (they may contain formatting codes and unicode glyphs).

  Recommended Agent Profile:
  - Category: unspecified-high

  Parallelization:
  - Can Run In Parallel: NO (depends on Tasks 4-8)
  - Blocked By: Tasks 4-8

  References:
  - `src/main/kotlin/club/sk1er/mods/levelhead/bedwars/BedwarsHttpUtils.kt` (`sanitizeForLogs()`)

  Acceptance Criteria:
  - Running the greps in Task 10 shows no sensitive logging patterns.

  QA Scenarios:
  ```text
  Scenario: Static safety scan
    Tool: Bash
    Steps:
      1. Run: grep -R "\[LevelheadDebug\]" -n src/main/kotlin/club/sk1er/mods/levelhead | tee .sisyphus/evidence/task-9-debug-lines.txt
      2. Run: grep -R "logger\\.(info|debug)" -n src/main/kotlin/club/sk1er/mods/levelhead/bedwars | grep -E "Authorization|API-Key" | tee .sisyphus/evidence/task-9-sensitive-scan.txt
    Expected Result: Debug lines exist; sensitive-scan output shows no lines that print header values.
  ```

- [ ] 10. Verification commands + evidence

  What to do:
  - Build and capture outputs.
  - Confirm log markers exist in the expected files.

  Recommended Agent Profile:
  - Category: quick

  Acceptance Criteria:
  - `./gradlew build` -> PASS
  - `./gradlew remapJar` (or the repo's jar task) -> PASS
  - Greps for log markers return matches.

  QA Scenarios:
  ```text
  Scenario: Build and marker verification
    Tool: Bash
    Steps:
      1. Run: ./gradlew build
      2. Run: ./gradlew remapJar
      3. Run: grep -R "\[LevelheadDebug\]" -n src/main/kotlin/club/sk1er/mods/levelhead | tee .sisyphus/evidence/task-10-markers.txt
      4. Save build output to: .sisyphus/evidence/task-10-gradle.txt
    Expected Result: build succeeds; remapJar succeeds; markers grep has matches.
  ```

---

## Final Verification Wave (parallel)

- [ ] F1. Plan Compliance Audit (oracle)
  - Verify new log lines exist only in the intended client/mod files.
  - Verify no backend (`backend/`) files are modified.

- [ ] F2. Safety Review (unspecified-high)
  - Search for any logging of secret-bearing fields and reject if found.

- [ ] F3. Performance/Spam Review (unspecified-high)
  - Confirm render sampling is throttled and not on a hot path when disabled.

- [ ] F4. Scope Fidelity Check (deep)
  - Ensure changes are strictly logging + config toggles, no behavior changes.

---

## Success Criteria

### Verification Commands
```bash
./gradlew build
grep -R "\[LevelheadDebug\]" -n src/main/kotlin/club/sk1er/mods/levelhead
```

### Final Checklist
- [ ] Debug toggles exist and default OFF
- [ ] Debug logs answer: when/why/requested, local cache warm/hit vs miss/expired, network response summary with proxy `X-Cache`, and tag text + colors
- [ ] Render sampling logs are throttled and gated
- [ ] No secrets are logged
