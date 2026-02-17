# Add `openapi.json` to Mod + Backend

## TL;DR
Copy the existing repo-root `openapi.json` into (1) the mod JAR resources and (2) the backend Docker build context, and expose it from the backend as `GET /openapi.json` (served verbatim).

Deliverables:
- `src/main/resources/openapi.json` included in built mod jar
- `backend/openapi.json` included in backend image/runtime
- Backend serves `GET /openapi.json` with `Content-Type: application/json`

Guardrails:
- Do not modify the OpenAPI contents.
- Do not add Swagger UI or codegen.
- Do not touch unrelated routes.

---

## Context (confirmed)
- Source spec exists: `openapi.json` (repo root).
- Mod resources live in `src/main/resources/` (packaged into jar by Gradle).
- Backend is Express bundled by esbuild to `backend/dist/index.js` (Docker context is `backend/`).
- Backend requires `HYPIXEL_API_KEY`, `CACHE_DB_URL`, `ADMIN_API_KEYS` at startup (`backend/src/config.ts`).

---

## Verification Strategy
- Automated unit tests: none (static packaging + one HTTP route).
- QA is command-based (docker compose + curl + jq + jar tf + sha256sum).
- Evidence path: `.sisyphus/evidence/`.

---

## Parallel Execution Waves

Wave 1 (implementation, parallel):
- Task 1: Backend - add `backend/openapi.json`
- Task 2: Backend - add `GET /openapi.json` route
- Task 3: Mod - add `src/main/resources/openapi.json`

Wave 2 (verification, parallel):
- Task 4: Backend QA (compose up + curl + container file check)
- Task 5: Mod QA (build jar + jar tf)
- Task 6: Consistency QA (sha256)

Wave FINAL (review, parallel):
- F1-F4 review passes

---

## TODOs

- [ ] 1. Backend: add `backend/openapi.json` (copy from repo-root)

  What to do:
  - Create `backend/openapi.json` with identical bytes to `openapi.json`.

  Must NOT do:
  - No content edits (no formatting/ordering/normalization).

  References:
  - `openapi.json`
  - `backend/Dockerfile` (image build context is `backend/`)

  Acceptance Criteria:
  - `sha256sum openapi.json backend/openapi.json` hashes match.

  QA Scenarios:
  ```bash
  sha256sum openapi.json backend/openapi.json
  ```

- [ ] 2. Backend: serve spec at `GET /openapi.json` (verbatim)

  What to do:
  - In `backend/src/index.ts`, add `app.get('/openapi.json', ...)`.
  - Serve `backend/openapi.json` via absolute path derived from `__dirname`.
  - Prefer `res.sendFile(...)` (verbatim bytes) and ensure JSON content-type.

  Must NOT do:
  - Do not `JSON.parse` + `res.json` (would reformat).
  - No new dependencies.

  References:
  - `backend/src/index.ts`
  - `backend/src/config.ts:319` (runtime file pattern: `path.resolve(__dirname, '..', 'package.json')`)

  Acceptance Criteria:
  - With backend running, `curl -sS http://localhost:3000/openapi.json | jq type` prints `"object"`.

  QA Scenarios:
  - Implemented by Task 4 (server lifecycle + curl).

- [ ] 3. Mod: add `src/main/resources/openapi.json` (copy from repo-root)

  What to do:
  - Create `src/main/resources/openapi.json` with identical bytes to `openapi.json`.

  Must NOT do:
  - No runtime usage code.

  References:
  - `src/main/resources/mcmod.info`
  - `build.gradle.kts`

  Acceptance Criteria:
  - `sha256sum openapi.json src/main/resources/openapi.json` hashes match.

  QA Scenarios:
  ```bash
  sha256sum openapi.json src/main/resources/openapi.json
  ```

- [ ] 4. Backend QA: compose up + curl + container file exists

  What to do:
  - Create `backend/.env` (do not commit) with safe dummy values.
  - Start stack via `backend/docker-compose.yml`.
  - Fetch `/openapi.json` and validate JSON.
  - Assert `/app/openapi.json` exists inside container.

  References:
  - `backend/docker-compose.yml`
  - `backend/.env.example`
  - `backend/src/config.ts:52` (required env enforcement)

  Acceptance Criteria:
  - HTTP 200 from `/openapi.json`.
  - `Content-Type` includes `application/json`.
  - File exists in container at `/app/openapi.json`.

  QA Scenarios:
  ```bash
  mkdir -p .sisyphus/evidence

  cp backend/.env.example backend/.env
  perl -pi -e 's/^HYPIXEL_API_KEY=.*/HYPIXEL_API_KEY=dev/' backend/.env
  perl -pi -e 's/^ADMIN_API_KEYS=.*/ADMIN_API_KEYS=dev/' backend/.env
  perl -pi -e 's|^CACHE_DB_URL=.*|CACHE_DB_URL=postgresql://levelhead:levelhead@postgres:5432/levelhead_cache|' backend/.env
  perl -pi -e 's/^CRON_API_KEYS=.*/CRON_API_KEYS=/' backend/.env

  docker compose --project-directory backend -f backend/docker-compose.yml up -d --build

  curl -sS -D .sisyphus/evidence/task-4-openapi.headers http://localhost:3000/openapi.json \
    -o .sisyphus/evidence/task-4-openapi.json
  jq type .sisyphus/evidence/task-4-openapi.json
  grep -i '^content-type:' .sisyphus/evidence/task-4-openapi.headers

  docker compose --project-directory backend -f backend/docker-compose.yml exec -T backend ls -l /app/openapi.json
  ```

- [ ] 5. Mod QA: build jar + assert `openapi.json` packaged

  What to do:
  - Build using Gradle.
  - Inspect jar contents.

  References:
  - `versions/1.8.9/` (expected output location)

  Acceptance Criteria:
  - `jar tf ... | grep -x openapi.json` returns a match.

  QA Scenarios:
  ```bash
  ./gradlew build
  ls -1 versions/1.8.9/build/libs/*.jar
  jar tf versions/1.8.9/build/libs/*.jar | grep -x 'openapi.json'
  ```

- [ ] 6. Consistency QA: all copies match source

  Acceptance Criteria:
  - All three sha256 hashes are identical.

  QA Scenarios:
  ```bash
  sha256sum openapi.json backend/openapi.json src/main/resources/openapi.json
  ```

---

## Final Verification Wave

- [ ] F1. Plan compliance audit — `oracle`
- [ ] F2. Code quality review — `unspecified-high`
- [ ] F3. Real QA run-through — `unspecified-high`
- [ ] F4. Scope fidelity check — `deep`

---

## Defaults Applied
- Backend serves at `GET /openapi.json` (public).
- Backend serves file bytes verbatim.
