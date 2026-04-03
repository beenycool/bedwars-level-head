## 2025-02-12 - Eliminate Promise.all(array.map) allocations
**Tech Debt:** High-throughput batch processing loops in `history.ts`, `player.ts`, and `playerPublic.ts` were utilizing `await Promise.all(array.map(item => limit(async () => ...)))`. This inherently creates two O(N) memory allocations: one for the intermediate closure state and another for the new array produced by `.map()` itself before passing it to `Promise.all()`.
**Learning:** In very hot paths (like processing large batch arrays or flushing memory history queues continuously), this native functional mapping generates massive, unnecessary pressure on the Garbage Collector. It triggers micro-stutters and increased RSS footprint.
**Prevention:** Rather than functional chaining in these critical limits, use procedural iteration: instantiate a clean array `const limitPromises = [];`, iterate over the items using a standard `for (let i = 0; i < array.length; i++)` loop, use `.push(limit(async () => ...))` into the array, and finally invoke `await Promise.all(limitPromises)`. This entirely circumvents intermediate array generation.

## 2025-03-30 - Fix Kysely QueryBuilder Generic Constraints

**Tech Debt:** The functions `buildDateRangeClause` and `buildSearchClause` in `backend/src/services/history.ts` used `any` as the output type for the `SelectQueryBuilder` parameter (e.g., `SelectQueryBuilder<Database, 'player_query_history', any>`).
**Learning:** Hardcoding the return shape to `any` within Kysely query extension helpers breaks strict type inference when the helper is applied to an upstream query. If the parent query has applied `.select()` mappings, casting it through a helper with `any` causes TypeScript to lose the projection types downstream.
**Prevention:** When writing shared query builder helpers, declare a generic type parameter for the output shape (e.g., `<O, QB extends SelectQueryBuilder<Database, 'table_name', O>>`) to perfectly preserve the existing row projection through the middleware chain without falling back to `any`.

## 2024-05-24 - Refactor Node.js Array .forEach to for-loop
**Tech Debt:** Found multiple instances of `.forEach` used for iterating over arrays (e.g. `results.forEach` in `player.ts` and `playerPublic.ts`), which allocates a new callback function for each iteration.
**Learning:** In hot Node.js endpoints (like the batch player stats endpoint), creating callbacks on every single array iteration generates unnecessary garbage, causing GC stutter which can drag down latency metrics under load.
**Prevention:** Always use traditional `for (let i = 0; i < array.length; i++)` or `for...of` loops instead of `.forEach()`, especially for array transformations and data handling on hot API paths.
