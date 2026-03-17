# Bolt learnings

## 2025-05-16 - DB Counting vs In-Memory/Redis Counting
**Learning:** `getSystemStats` in `backend/src/services/history.ts` executed an unindexed `SELECT COUNT(*)` on `hypixel_api_calls` for the last hour on every call. This bypassed the highly optimized Redis `ZCOUNT` implementation already present in `backend/src/services/hypixelTracker.ts` (`getHypixelCallCount`), creating a significant database bottleneck for the analytics dashboard while also missing buffered/in-flight statistics.
**Action:** When calculating sliding-window aggregates, always prioritize existing Redis/in-memory abstractions (like `getHypixelCallCount`) over raw database count queries to leverage `O(log N)` complexity and reduce database load.

## 2025-05-16 - Array Processing Memory Allocations
**Learning:** During high-throughput background processing, like the `flushHistoryBuffer` database `UNNEST` build or buffer counting, combining methods like `.filter().length` or chaining multiple `.map()` functions causes unnecessary O(N) array memory allocations (e.g. 13 arrays for 13 columns).
**Action:** In Node.js server hot paths or large recurring loops, use a single standard `for` loop to directly compute counters or populate pre-allocated arrays, eliminating expensive intermediate array instantiations and Garbage Collection pressure.

## 2025-05-16 - Sequential Awaits in Stats Queries
**Learning:** `getSystemStats` and `getPlayerQueryPage` inside `backend/src/services/history.ts` were awaiting independent asynchronous operations sequentially (e.g. executing a query, waiting for it, then executing a count query). Further, `backend/src/routes/stats.ts` was executing `getPlayerQueryCount` in its `Promise.all` array at the exact same time as `getPlayerQueryPage`, completely negating the optimization where the latter could fetch its own count (and running identical count queries in parallel).
**Action:** Always look for `await` statements inside a function that do not depend on the result of a previous `await` - these should be wrapped in `Promise.all()`. Furthermore, verify if higher-level controllers (like routes) are duplicating work that is already performed by lower-level functions.

## 2025-05-15 - Double Serialization in Redis Cache
**Learning:** I discovered that `backend/src/services/statsCache.ts` was stringifying the `payload` object BEFORE adding it to the cache entry wrapper, which was then stringified again. This resulted in double serialization (string inside string), wasting CPU cycles and bytes (escaped quotes). Interestingly, `backend/src/services/redis.ts` already had the optimized implementation, but `statsCache.ts` (which is specific to player stats) re-implemented it inefficiently.
**Action:** When working with Redis or any storage wrapper, always check if the wrapper handles serialization. If so, pass objects directly. Also, look for "parallel" implementations of similar logic in the codebase (`statsCache.ts` vs `redis.ts`) as they often diverge in quality.

## 2025-05-15 - Efficient Object Aggregation
**Learning:** In `backend/src/services/hypixel.ts`, iterating over a large stats object (~10k keys) using `Object.entries(stats)` combined with `key.startsWith(prefix)` inside a loop called multiple times (4x per game mode) was extremely inefficient (O(M*N) + allocation). Switching to a single pass using `for (const key in stats)` reduced execution time by ~10x (29ms -> 2.8ms).
**Action:** When aggregating data from large objects (like Hypixel API responses), avoid `Object.entries` if you just need to scan keys. Use a single pass `for..in` loop to calculate multiple aggregates simultaneously, avoiding repeated scans and intermediate array allocations.

## 2025-05-16 - Pagination Refactoring Pitfall
**Learning:** Refactoring sequential database calls into parallel executions (using `Promise.all`) inside controllers can sometimes silently break business logic if one call depends on the other. For instance, computing the correct database `OFFSET` for pagination relies on querying the total count first to clamp out-of-bounds `page` arguments. Parallelizing them broke the clamping, returning empty queries for invalid pages.
**Action:** When attempting to parallelize database queries, meticulously check if variables derived from one query are being passed as arguments to another query, even indirectly (like pagination offsets). Use `Promise.all` inside nested async IIFEs if partial dependency is present.

## 2025-05-16 - LRU Cache Hit Defeated by Async Abstraction
**Learning:** `resolvePlayer` wrapped cache checks (`getMemoized`) inside an inner `async executor` function and registered that promise in an `inFlightRequests` Map. While this successfully deduplicated in-flight fetches, it forced immediate, synchronous `LRUCache` hits to undergo Promise allocation, Map insertion, and deferred microtask resolution, nullifying the CPU advantages of the fast path.
**Action:** When working with synchronous in-memory caches (like `LRUCache`), always evaluate the fast-path check as high up in the call stack as possible, *before* allocating closure states, tracking promises, or entering an `async` execution context.

## 2025-05-16 - Array Methods in Recursive Tree Serialization
**Learning:** The `canonicalize` utility (used heavily for payload signature verification) was using `Object.entries().sort().map().join()` to serialize deeply nested JSON objects. This resulted in creating a massive number of intermediate arrays (one for the entries, one for each element mapped, and one for the overall string array to join) at every level of the tree. When processing deep, extensive Hypixel stat payloads, this caused severe V8 Garbage Collection pressure.
**Action:** In Node.js backend services, avoid using `.map().join()` or `Object.entries()` inside highly recursive payload traversal or serialization functions. Replace them with traditional memory-efficient `for` loops and direct string concatenation to prevent exponential intermediate object allocations.

## 2025-05-16 - Cost-based Rate Limiting for Public Batch Endpoints
**Learning:** Public batch endpoints (e.g., `/api/public/player/batch`) were using a static per-request rate limit (`enforcePublicRateLimit`). This creates a vulnerability where attackers could bypass the rate limit by packing maximum permitted items into each request (e.g. 20 items), causing resource exhaustion proportional to the payload size rather than request count.
**Action:** For batch endpoints that consume resources proportional to array payload length, implement and apply a dynamic, cost-based rate limiting middleware (like `enforcePublicBatchRateLimit`) that counts each item in the payload as an individual token against the rate limit bucket.
