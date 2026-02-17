# Urchin Integration (Backend + Mod Fallback)

## TL;DR

> **Quick Summary**: Add Urchin blacklist/tag lookups (per `openapi.json`) to the proxy backend and the Minecraft mod, with backend as the primary source and a mod-side direct fallback.
>
> **Deliverables**:
> - Backend: Urchin client + caching + API exposure and live (gated) integration tests
> - Mod: `/levelhead whois` shows Urchin tags, tab-list marker, and a match-join chat announcement
> - Security: no API keys committed/logged; mod fallback disabled unless user config provides a key
>
> **Estimated Effort**: Large
> **Parallel Execution**: YES (4 waves)
> **Critical Path**: Backend client/config -> backend exposure/caching -> mod consumption -> mod UI/announce -> verification

---

## Context

### Original Request
- "add urchin integration. use openapi.json to see the api format"
- Testing requested using a provided API key (treat as secret; do not commit or log it).
- "ultrabrain" (high rigor and edge-case handling expected).

### Confirmed Decisions
- Integration target: BOTH backend proxy + mod direct fallback.
- Default Urchin lookup scope: in-game + party + chat (`sources=GAME,PARTY,CHAT`).
- Chat announcement timing: fire when joining a match.
- Tests: live integration tests are desired (but must be gated; never hardcode a key).

### Urchin API Contract (source of truth)
- OpenAPI file: `openapi.json`
- Server: `https://urchin.ws`
- Auth parameter used by the defined endpoints: query parameter `key` (required).
- Required lookup parameter: `sources` (comma-separated list).
- Relevant endpoints:
  - `GET /player/{username}` (accepts username or UUID) -> `PlayerResponse` (uuid, tags[], rate_limit)
  - `POST /player` batch -> `BatchPlayerResponse` (players: { [username]: Tag[] }, rate_limit)
  - `GET /cubelify` -> overlay-style `CubelifyResponse` (score + tags)

### Metis Review (Guardrails + Gaps Addressed)
- Do not ship secrets: backend key is server-only; mod fallback requires user-supplied key in local config and is disabled by default.
- Do not leak keys in logs/errors; add explicit redaction.
- Avoid turning the backend into an open proxy: hardcode Urchin base URL and constrain parameters.
- Rate limit / stampede protection: dedupe in-flight lookups, cache results, respect 429 Retry-After.
- Clarify that "CHAT" is an Urchin *source selector* (not the mod collecting chat logs).

---

## Work Objectives

### Core Objective
Add Urchin tag lookups to the backend and mod in a way that is secure (no key leaks), resilient (caching + fallbacks), and low-noise (no chat spam / no render-thread blocking).

### Concrete Deliverables
- Backend:
  - Urchin HTTP client module
  - Cached Urchin tag lookup service (single + batch)
  - Backward-compatible API exposure for the mod to consume
  - Live integration test suite that only runs when `URCHIN_API_KEY` is present
- Mod:
  - `/levelhead whois` includes Urchin tag information
  - Tab list marker for players with Urchin tags
  - Match-join chat announcement summarizing tagged players
  - Direct fallback client (OkHttp) when backend Urchin data is unavailable AND user configured a key

### Must NOT Have (Non-negotiable)
- No API keys committed to git (backend or mod).
- No printing/logging of the Urchin key (including query strings) in backend logs or mod debug logging.
- No blocking calls on the render thread (tab list marker must use cached/asynchronous data).
- No per-player request storm on match join; must batch/dedupe and cache.

---

## Verification Strategy (MANDATORY)

> ZERO HUMAN INTERVENTION — verification steps must be agent-executable.

### Test Decision
- Backend automated tests: YES
  - Style: mix of unit tests (mocked) + live integration tests (gated by env var).
  - Live tests must SKIP (not fail) when `URCHIN_API_KEY` is not present.
- Mod automated tests: minimal unit tests for pure helper functions (parsing/formatting/summary), plus build verification (`./gradlew build`).

### QA Policy
Evidence saved to `.sisyphus/evidence/`.

| Deliverable Type | Verification Tool | Method |
|------------------|-------------------|--------|
| Backend HTTP client/service | Jest | Run unit tests + gated live integration tests |
| Backend routes | Bash (curl) | Call endpoints and assert response shape/status |
| Mod logic (non-MC runtime) | Gradle | `./gradlew test` and `./gradlew build` |

---

## Execution Strategy

### Parallel Execution Waves

Wave 1 (Foundations — can start immediately):
├── Task 1: Backend Urchin config + redaction utilities
├── Task 2: Backend OpenAPI contract sanity checks
├── Task 3: Backend Urchin HTTP client module
├── Task 4: Backend Urchin cache + dedupe primitives
├── Task 5: Mod Urchin config toggles + key handling (no key shipped)
├── Task 6: Mod Urchin tag model + pure helper functions
└── Task 7: Mod unit test scaffolding (Gradle/JUnit) for helper functions

Wave 2 (Core backend + mod whois):
├── Task 8: Backend Urchin lookup service (single + batch) using cache/dedupe
├── Task 9: Backend API exposure (backward-compatible) for mod consumption
├── Task 10: Backend Jest tests (mocked) + gated live integration tests
├── Task 11: Backend operator docs + env templates
└── Task 12: Mod `/levelhead whois` integration (backend-first, fallback optional)

Wave 3 (Mod UI + match join behavior):
├── Task 13: Mod tab-list marker (mixin) backed by cached Urchin state
├── Task 14: Mod match-join chat announcement (batched, rate-limited)
└── Task 15: Mod direct fallback Urchin client (OkHttp) + rate limiting + batch scan

Wave 4 (Integration hardening):
├── Task 16: Cross-layer consistency (field names, error mapping, toggles)
├── Task 17: End-to-end backend curl QA scripts + evidence
└── Task 18: Build + test verification for both projects (backend + mod)

Critical Path: 1 -> 3 -> 4 -> 8 -> 9 -> 12 -> 13/14 -> 16 -> 18

---

## TODOs

> Implementation + tests are part of the same task.
> Every task MUST include agent-executed QA scenarios.

- [ ] 1. Backend Urchin config + redaction utilities

  What to do:
  - Add `URCHIN_*` config knobs to backend config with safe defaults (suggested):
    - `URCHIN_ENABLED` (default false)
    - `URCHIN_API_KEY` (required when enabled)
    - `URCHIN_BASE_URL` (default `https://urchin.ws`)
    - `URCHIN_SOURCES` (default `GAME,PARTY,CHAT`)
    - `URCHIN_TIMEOUT_MS` (default 5000)
    - `URCHIN_CACHE_TTL_MS` (default e.g. 10 minutes)
    - `URCHIN_CACHE_STALE_TTL_MS` (default e.g. 24 hours)
  - Add a redaction helper that strips `key` from logged URLs/query strings.

  Must NOT do:
  - Do not print the key in errors, debug logs, or request logs.

  Recommended Agent Profile:
  - Category: quick
  - Skills: []

  Parallelization:
  - Can Run In Parallel: YES (Wave 1)

  References:
  - `backend/src/config.ts` - existing env parsing/required-secret pattern.
  - `backend/src/util/requestUtils.ts` - existing request/logging utilities to extend for redaction.
  - `openapi.json` - confirms auth uses query param `key` in path definitions.

  Acceptance Criteria:
  - `cd backend && npm run build` succeeds after adding new config.
  - Any logging path that includes URLs redacts query param `key`.

  QA Scenarios:
  - Scenario: Redaction works
    - Tool: Jest (unit)
    - Steps: call redaction helper with URL containing `?key=...` and assert output does not include the key
    - Evidence: `.sisyphus/evidence/task-1-redaction.txt`

- [ ] 2. Backend OpenAPI contract sanity checks

  What to do:
  - Add a lightweight test (or script executed by Jest) that parses `openapi.json` and asserts the endpoints/params we depend on exist:
    - `/player/{username}` GET has query params `key` and `sources`
    - `/player` POST has query params `key` and `sources`

  Must NOT do:
  - No code generation required.

  Recommended Agent Profile:
  - Category: quick

  Parallelization:
  - Can Run In Parallel: YES (Wave 1)

  References:
  - `openapi.json` - the file to parse and validate.
  - `backend/tests/security/admin_dos.test.ts` - Jest + TS patterns.

  Acceptance Criteria:
  - `cd backend && npx jest tests/...` includes a passing contract sanity test.

  QA Scenarios:
  - Scenario: Contract test passes
    - Tool: Bash
    - Steps: `cd backend && npx jest <new-contract-test>`
    - Evidence: `.sisyphus/evidence/task-2-openapi-contract.txt`

- [ ] 3. Backend Urchin HTTP client module

  What to do:
  - Create an Urchin client module that calls `https://urchin.ws` per OpenAPI.
  - Implement:
    - Single lookup (player by uuid/username)
    - Batch lookup (player list by username)
    - `sources` handling using default `GAME,PARTY,CHAT` but allowing override
    - Timeouts and conservative retry/backoff (do not retry 401/403/429)
    - Proper error mapping via existing `HttpError`
    - Ensure query param `key` is used and never logged

  Recommended Agent Profile:
  - Category: unspecified-high

  Parallelization:
  - Can Run In Parallel: YES (Wave 1)
  - Blocked By: Task 1

  References:
  - `backend/src/services/hypixel.ts` - axios client setup + retry pattern + HttpError usage.
  - `backend/src/services/mojang.ts` - simple external client pattern.
  - `backend/src/util/httpError.ts` - standardized error shape.
  - `openapi.json` - request/response schemas.

  Acceptance Criteria:
  - Client functions exist for single + batch.
  - 401/403 treated as non-retryable and surfaced as clear errors.
  - 429 captures Retry-After header when present.

  QA Scenarios:
  - Scenario: Live single lookup returns expected shape (gated)
    - Tool: Jest
    - Preconditions: `URCHIN_API_KEY` set
    - Steps:
      - Call single lookup for a stable username (e.g. `Notch`) with `sources=GAME,PARTY,CHAT`
      - Assert the request does NOT return 401/403
      - If 200: assert body contains `uuid` and `tags` array
      - If 404: accept (player not in Urchin DB is not a failure)
    - Evidence: `.sisyphus/evidence/task-3-live-single.txt`
  - Scenario: Missing key skips live tests
    - Tool: Jest
    - Preconditions: `URCHIN_API_KEY` unset
    - Steps: run test suite and confirm live tests are skipped, not failed
    - Evidence: `.sisyphus/evidence/task-3-live-skip.txt`

- [ ] 4. Backend Urchin cache + dedupe primitives

  What to do:
  - Add caching for Urchin tag results (TTL + stale-while-revalidate if feasible).
  - Ensure in-flight dedupe (singleflight) so a match scan doesn’t cause a stampede.

  Recommended Agent Profile:
  - Category: deep

  Parallelization:
  - Can Run In Parallel: YES (Wave 1)
  - Blocked By: Task 3

  References:
  - `backend/src/services/statsCache.ts` - dedupe + SWR patterns.
  - `backend/src/services/redis.ts` - Redis client.
  - `backend/src/services/cache.ts` - L2 caching patterns.

  Acceptance Criteria:
  - Second lookup for same player hits cache (no outbound call) within TTL.

  QA Scenarios:
  - Scenario: Cache hit prevents second outbound request
    - Tool: Jest (mocked)
    - Steps: mock Urchin client, call lookup twice, assert client called once
    - Evidence: `.sisyphus/evidence/task-4-cache-hit.txt`

- [ ] 5. Mod Urchin config toggles + key handling

  What to do:
  - Add config toggles:
    - enable/disable Urchin features
    - enable chat announce
    - enable tab marker
    - optional Urchin key for direct fallback (blank by default)
  - Document (in config description/help text) that "CHAT" is an Urchin source selector.

  Must NOT do:
  - Do not embed any key in code or defaults.

  Recommended Agent Profile:
  - Category: quick

  Parallelization:
  - Can Run In Parallel: YES (Wave 1)

  References:
  - `src/main/kotlin/club/sk1er/mods/levelhead/config/LevelheadConfig.kt` - OneConfig toggle patterns.
  - `src/main/kotlin/club/sk1er/mods/levelhead/config/MasterConfig.kt` - config model.

  Acceptance Criteria:
  - Default direct-fallback key is empty.
  - Disabling Urchin features removes marker/announce behavior.

  QA Scenarios:
  - Scenario: Config defaults safe
    - Tool: Gradle
    - Steps: compile and run unit test that asserts default config key field is blank
    - Evidence: `.sisyphus/evidence/task-5-config-defaults.txt`

- [ ] 6. Mod Urchin tag model + pure helper functions

  What to do:
  - Define a minimal Urchin tag representation for the mod:
    - tag type
    - optional reason (for whois)
    - timestamp optional
  - Implement pure functions:
    - normalize tags for display
    - compute tab marker string (default: prefix player name with `[U]` or a single unicode-free marker like `!`)
    - compute match-join announcement message body (default: `Urchin: <N> tagged players: name1(type1), name2(type2)`; truncate list to avoid spam)

  Recommended Agent Profile:
  - Category: unspecified-high

  Parallelization:
  - Can Run In Parallel: YES (Wave 1)

  References:
  - `openapi.json#/components/schemas/Tag` - tag fields.
  - `src/main/kotlin/club/sk1er/mods/levelhead/core/StatsFormatter.kt` - formatting patterns.

  Acceptance Criteria:
  - Helper functions have deterministic outputs and no Minecraft dependencies.

  QA Scenarios:
  - Scenario: Announcement formatting stable
    - Tool: Gradle test
    - Steps: run unit tests for helper functions with fixed inputs
    - Evidence: `.sisyphus/evidence/task-6-helper-tests.txt`

- [ ] 7. Mod unit test scaffolding (Gradle/JUnit)

  What to do:
  - Add minimal Kotlin unit test dependencies and a test source set to run helper tests.

  Recommended Agent Profile:
  - Category: quick

  Parallelization:
  - Can Run In Parallel: YES (Wave 1)
  - Blocks: Task 6 tests, Task 13/14 message/marker tests

  References:
  - `build.gradle.kts` - add test dependencies.

  Acceptance Criteria:
  - `./gradlew test` runs at least one test file.

  QA Scenarios:
  - Scenario: Gradle tests run
    - Tool: Bash
    - Steps: `./gradlew test`
    - Evidence: `.sisyphus/evidence/task-7-gradle-test.txt`

- [ ] 8. Backend Urchin lookup service (single + batch) using cache/dedupe

  What to do:
  - Build a service layer that:
    - prefers cache
    - uses Urchin client
    - normalizes tags into a stable internal format
    - supports both single UUID/IGN and batch by usernames

  Recommended Agent Profile:
  - Category: deep

  Parallelization:
  - Can Run In Parallel: YES (Wave 2)
  - Blocked By: Tasks 1, 3, 4

  References:
  - `backend/src/services/player.ts` - existing player orchestration patterns.
  - `backend/src/services/statsCache.ts` - caching/dedupe patterns.

  Acceptance Criteria:
  - Service returns normalized tags and does not throw raw Axios errors.

  QA Scenarios:
  - Scenario: Batch lookup returns mapping
    - Tool: Jest (mocked)
    - Steps: mock Urchin client batch response and assert normalization output
    - Evidence: `.sisyphus/evidence/task-8-batch-mocked.txt`

- [ ] 9. Backend API exposure (backward-compatible) for mod consumption

  What to do:
  - Expose Urchin data to the mod without breaking existing clients by augmenting existing player responses (no new public endpoints):
    - `GET /api/public/player/:identifier` and `GET /api/player/:identifier` include an optional `urchin` object.
  - Suggested response shape (keep it minimal and stable):
    - `urchin: { status: 'ok'|'disabled'|'unavailable'|'error', sources: string, tags: Array<{ type: string, reason?: string, added_on?: string }>, fetched_at?: string }`
  - Ensure rate limiting applies to the new behavior.

  Recommended Agent Profile:
  - Category: unspecified-high

  Parallelization:
  - Can Run In Parallel: YES (Wave 2)
  - Blocked By: Task 8

  References:
  - `backend/src/routes/playerPublic.ts` - public route shape.
  - `backend/src/routes/player.ts` - private route shape.
  - `backend/src/middleware/rateLimitPublic.ts` - public limiter.

  Acceptance Criteria:
  - Existing response fields remain unchanged.
  - New `urchin.status` is `disabled` when `URCHIN_ENABLED=false`.
  - New `urchin.status` is `unavailable` when enabled but key missing.

  QA Scenarios:
  - Scenario: Curl response includes urchin field when enabled
    - Tool: Bash (curl)
    - Preconditions: backend running with `URCHIN_API_KEY` set
    - Steps: call the public player route and assert JSON contains `urchin.status` and `urchin.tags`
    - Evidence: `.sisyphus/evidence/task-9-curl-public.txt`

- [ ] 10. Backend Jest tests (mocked) + gated live integration tests

  What to do:
  - Add `test` scripts to `backend/package.json`.
  - Add mocked unit tests for normalization, caching, and route integration.
  - Add live tests that hit `https://urchin.ws` only when `URCHIN_API_KEY` is set.

  Recommended Agent Profile:
  - Category: deep

  Parallelization:
  - Can Run In Parallel: YES (Wave 2)

  References:
  - `backend/jest.config.js` - jest config.
  - `backend/tests/security/admin_dos.test.ts` - existing mocking style.
  - `backend/package.json` - add `test` scripts.

  Acceptance Criteria:
  - `cd backend && npm test` works.
  - Live tests skip cleanly when key absent.

  QA Scenarios:
  - Scenario: Run all backend tests
    - Tool: Bash
    - Steps: `cd backend && npm test`
    - Evidence: `.sisyphus/evidence/task-10-backend-tests.txt`

- [ ] 11. Backend operator docs + env templates

  What to do:
  - Update:
    - `backend/.env.example`
    - `backend/README.md`
    - `backend/docker-compose.yml`
  - Document:
    - env var names
    - what `sources` means
    - rate limit behavior
    - live test gating

  Recommended Agent Profile:
  - Category: writing

  Parallelization:
  - Can Run In Parallel: YES (Wave 2)

  References:
  - `backend/.env.example`
  - `backend/README.md`
  - `openapi.json` - sources list to document.

  Acceptance Criteria:
  - Docs contain no secrets and explain how to configure locally.

  QA Scenarios:
  - Scenario: Grep for accidental key strings
    - Tool: Bash
    - Steps: search repo for `URCHIN_API_KEY=` usage and ensure no hardcoded values
    - Evidence: `.sisyphus/evidence/task-11-no-secrets.txt`

- [ ] 12. Mod `/levelhead whois` integration (backend-first, fallback optional)

  What to do:
  - Extend whois output to include Urchin tags:
    - Prefer backend-provided Urchin data when proxy is used.
    - If backend data unavailable AND user configured mod key, use direct Urchin client.

  Recommended Agent Profile:
  - Category: unspecified-high

  Parallelization:
  - Can Run In Parallel: YES (Wave 2)
  - Blocked By: Tasks 5, 6, and backend Task 9 if backend-first.

  References:
  - `src/main/kotlin/club/sk1er/mods/levelhead/commands/WhoisService.kt` - identifier resolution.
  - `src/main/kotlin/club/sk1er/mods/levelhead/commands/WhoisCommand.kt` - output format.
  - `src/main/kotlin/club/sk1er/mods/levelhead/bedwars/ProxyClient.kt` - proxy call patterns.

  Acceptance Criteria:
  - Whois prints an Urchin section when tags exist.
  - When Urchin disabled/unavailable: whois remains functional and prints a minimal status line or nothing.

  QA Scenarios:
  - Scenario: Whois formatting helper unit test
    - Tool: Gradle test
    - Steps: unit test the formatting function with sample tags
    - Evidence: `.sisyphus/evidence/task-12-whois-format.txt`

- [ ] 13. Mod tab-list marker (mixin) backed by cached Urchin state

  What to do:
  - Add a small marker in tab list for players with Urchin tags.
  - Must be non-blocking: only use cached state; schedule refresh asynchronously.

  Recommended Agent Profile:
  - Category: ultrabrain
  - Skills: []

  Parallelization:
  - Can Run In Parallel: YES (Wave 3)
  - Blocked By: Tasks 5, 6, 15 (for direct fallback data) and/or backend Task 9

  References:
  - `src/main/java/club/sk1er/mods/levelhead/mixin/MixinGuiPlayerTabOverlay.java` - tab overlay injection point.
  - `src/main/kotlin/club/sk1er/mods/levelhead/core/DisplayManager.kt` - player lifecycle hooks.

  Acceptance Criteria:
  - Marker string is stable and does not break tab layout.
  - Marker toggles off via config.

  QA Scenarios:
  - Scenario: Marker computation unit test
    - Tool: Gradle test
    - Steps: test the pure marker function for tagged vs untagged players
    - Evidence: `.sisyphus/evidence/task-13-marker-test.txt`

- [ ] 14. Mod match-join chat announcement (batched, rate-limited)

  What to do:
  - On match join:
    - run a single batched Urchin scan for current players
    - post ONE local chat message summarizing tagged players
  - Ensure it fires once per match (avoid spam across world changes).

  Recommended Agent Profile:
  - Category: ultrabrain

  Parallelization:
  - Can Run In Parallel: YES (Wave 3)
  - Blocked By: Tasks 5, 6, and 15 (data source)

  References:
  - `src/main/kotlin/club/sk1er/mods/levelhead/core/ModeManager.kt` - game/mode detection.
  - `src/main/kotlin/club/sk1er/mods/levelhead/Levelhead.kt` - fetchBatch orchestration and cache.

  Acceptance Criteria:
  - Announcement is emitted once per match join.
  - Announcement respects config toggle.

  QA Scenarios:
  - Scenario: Announcement message unit test
    - Tool: Gradle test
    - Steps: feed sample tagged player map and assert announcement string
    - Evidence: `.sisyphus/evidence/task-14-announce-test.txt`

- [ ] 15. Mod direct fallback Urchin client (OkHttp) + rate limiting + batch scan

  What to do:
  - Implement direct Urchin API calls using existing OkHttp utilities:
    - Batch lookup using `POST /player` by usernames
    - Single lookup using `GET /player/{username}` for whois
    - Query params: `key` and `sources=GAME,PARTY,CHAT`
  - Add a dedicated rate limiter so it cannot spam the API.
  - Use backend-first: direct fallback only when backend missing/unreachable AND key configured.

  Recommended Agent Profile:
  - Category: deep

  Parallelization:
  - Can Run In Parallel: YES (Wave 3)
  - Blocked By: Task 5

  References:
  - `src/main/kotlin/club/sk1er/mods/levelhead/bedwars/BedwarsHttpUtils.kt` - retries + Retry-After handling.
  - `src/main/kotlin/club/sk1er/mods/levelhead/core/RateLimiter.kt` - token bucket.
  - `openapi.json` - request body for batch endpoint.

  Acceptance Criteria:
  - When key is blank, direct fallback is disabled.
  - On 429, client honors Retry-After if present and backs off.

  QA Scenarios:
  - Scenario: Fallback disabled without key
    - Tool: Gradle test
    - Steps: ensure client refuses to make requests when key is blank
    - Evidence: `.sisyphus/evidence/task-15-no-key.txt`

- [ ] 16. Cross-layer consistency (field names, error mapping, toggles)

  What to do:
  - Ensure backend and mod agree on:
    - field names for `urchin` payload
    - tag type strings
    - disabled/unavailable semantics
  - Ensure backend errors don’t bubble into UI; provide user-friendly status strings.

  Recommended Agent Profile:
  - Category: deep

  Parallelization:
  - Can Run In Parallel: YES (Wave 4)
  - Blocked By: Tasks 9, 12, 15

  References:
  - `backend/src/util/httpError.ts` - error semantics.
  - `src/main/kotlin/club/sk1er/mods/levelhead/core/DebugLogging.kt` - avoid key leaks.

  Acceptance Criteria:
  - Disabling Urchin results in no outbound calls.
  - Invalid key produces a clear local-only message (not spam).

  QA Scenarios:
  - Scenario: Disabled flag prevents outbound
    - Tool: Jest + Gradle
    - Steps: unit tests for both sides confirming short-circuit behavior
    - Evidence: `.sisyphus/evidence/task-16-disabled.txt`

- [ ] 17. End-to-end backend curl QA scripts + evidence

  What to do:
  - Add a short runbook (or scripted commands) for verifying backend Urchin behavior locally with curl.

  Recommended Agent Profile:
  - Category: writing

  Parallelization:
  - Can Run In Parallel: YES (Wave 4)
  - Blocked By: Task 9

  References:
  - `backend/README.md` - existing operator instructions.

  Acceptance Criteria:
  - Runbook includes exact curl commands and expected status/fields.

  QA Scenarios:
  - Scenario: Curl checks
    - Tool: Bash
    - Steps: run documented curls and save output
    - Evidence: `.sisyphus/evidence/task-17-curl-runbook.txt`

- [ ] 18. Build + test verification for both projects

  What to do:
  - Ensure:
    - backend builds and tests pass
    - mod builds and tests pass

  Recommended Agent Profile:
  - Category: unspecified-high

  Parallelization:
  - Can Run In Parallel: NO (final wave)

  References:
  - `backend/package.json` - build/test commands.
  - `build.gradle.kts` - Gradle build.

  Acceptance Criteria:
  - `cd backend && npm run build` passes
  - `cd backend && npm test` passes (live tests may skip if key absent)
  - `./gradlew build` passes
  - `./gradlew test` passes

  QA Scenarios:
  - Scenario: Full build and test run
    - Tool: Bash
    - Steps: run the four commands and capture output
    - Evidence: `.sisyphus/evidence/task-18-build-all.txt`

---

## Final Verification Wave (MANDATORY)

- [ ] F1. Plan Compliance Audit — oracle
  Verify Must-Haves/Must-NOTs, ensure no key leaks in logs, and evidence files exist.

- [ ] F2. Code Quality Review — unspecified-high
  Run typechecks/lints/tests for backend and Gradle build for mod; scan for accidental query logging.

- [ ] F3. QA Scenario Replay — unspecified-high
  Re-run all QA scenarios and ensure evidence paths exist.

- [ ] F4. Scope Fidelity Check — deep
  Confirm changes match plan scope; no unrelated refactors.

---

## Commit Strategy (suggested)

- Commit A (backend foundations): config + client + cache skeleton
- Commit B (backend exposure + tests)
- Commit C (mod config + model + whois)
- Commit D (tab marker + match announce + fallback client)

---

## Success Criteria

Verification commands:
```bash
cd backend && npm run build
cd backend && npm test
./gradlew test
./gradlew build
```

Final checklist:
- [ ] No secrets committed; key never logged
- [ ] Backend exposes Urchin tags safely and caches/dedupes
- [ ] Mod shows tags in whois, marks tab list, and announces once per match join
- [ ] All QA evidence files exist under `.sisyphus/evidence/`
