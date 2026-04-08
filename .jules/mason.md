# Mason Learnings

## 2025-02-12 - Eliminate Promise.all(array.map) allocations

**Tech Debt:** High-throughput batch processing loops in `history.ts`, `player.ts`, and `playerPublic.ts` were utilizing `await Promise.all(array.map(item => limit(async () => ...)))`. This inherently creates two O(N) memory allocations: one for the intermediate closure state and another for the new array produced by `.map()` itself before passing it to `Promise.all()`.
**Learning:** In very hot paths (like processing large batch arrays or flushing memory history queues continuously), this native functional mapping generates massive, unnecessary pressure on the Garbage Collector. It triggers micro-stutters and increased RSS footprint.
**Prevention:** Rather than functional chaining in these critical limits, use procedural iteration: instantiate a clean array `const limitPromises = [];`, iterate over the items using a standard `for (let i = 0; i < array.length; i++)` loop, use `.push(limit(async () => ...))` into the array, and finally invoke `await Promise.all(limitPromises)`. This entirely circumvents intermediate array generation.

## 2025-03-30 - Fix Kysely QueryBuilder Generic Constraints

**Tech Debt:** The functions `buildDateRangeClause` and `buildSearchClause` in `backend/src/services/history.ts` used `any` as the output type for the `SelectQueryBuilder` parameter (e.g., `SelectQueryBuilder<Database, 'player_query_history', any>`).
**Learning:** Hardcoding the return shape to `any` within Kysely query extension helpers breaks strict type inference when the helper is applied to an upstream query. If the parent query has applied `.select()` mappings, casting it through a helper with `any` causes TypeScript to lose the projection types downstream.
**Prevention:** When writing shared query builder helpers, declare a generic type parameter for the output shape (e.g., `<O, QB extends SelectQueryBuilder<Database, 'table_name', O>>`) to perfectly preserve the existing row projection through the middleware chain without falling back to `any`.

## 2025-06-25 - Eliminate .map().join() Intermediate Array Allocations

**Tech Debt:** Generating HTML tables and strings via chained array operations (`.map(fn).join('\n')`) in `stats.ts` (both server-side SSR and client-side JS logic).
**Learning:** For arrays with thousands of lookups, `.map().join()` allocates an entire intermediate array of mapped strings before joining them into a final output string. This introduces severe O(N) memory overhead and stresses the Garbage Collector on hot reporting and rendering routes.
**Prevention:** Optimize string generation loops by replacing `.map().join()` with standard `for` loops and direct string concatenation (`+=`), which completely bypasses the intermediate array allocation.

## 2026-04-03 - Refactor Node.js Array .forEach to for-loop

**Tech Debt:** Found multiple instances of `.forEach` used for iterating over arrays (e.g. `results.forEach` in `player.ts` and `playerPublic.ts`).
**Learning:** In hot Node.js endpoints (like the batch player stats endpoint), the function call overhead and internal iterator logic of `.forEach` can impact latency under high load.
**Prevention:** Prefer `for...of` or indexed `for` loops instead of `.forEach()` on hot API paths.

## 2026-04-07 - Extract strictly typed batch identifier utilities to remove 'as' casts

**Tech Debt:** Inline `as { ... }` and `as Record<string, unknown>` type assertions were repeatedly used to access properties on `req.body` and payload objects, bypassing strict type safety.
**Learning:** Extracting type assertions into shared utilities (e.g., `extractBatchIdentifiersFromBody`) is a solid refactor, but doing so blindly can introduce DoS vulnerabilities if bounding checks (e.g., length verification) are inadvertently moved to *after* iteration/deduplication steps.
**Prevention:** When refactoring payload extraction, always ensure that array length limits and bounding gates remain placed *before* any unbounded iteration (like deduplication loops or regex validations). Use the `isNonArrayObject` type guard directly to satisfy TypeScript without inline casting.
