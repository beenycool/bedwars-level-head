# Bolt learnings

## 2025-05-16 - Sequential Awaits in Stats Queries

**Learning:** `getSystemStats` and `getPlayerQueryPage` inside `backend/src/services/history.ts` were awaiting independent asynchronous operations sequentially (e.g. executing a query, waiting for it, then executing a count query). Further, `backend/src/routes/stats.ts` was executing `getPlayerQueryCount` in its `Promise.all` array at the exact same time as `getPlayerQueryPage`, completely negating the optimization where the latter could fetch its own count (and running identical count queries in parallel).
**Action:** Always look for `await` statements inside a function that do not depend on the result of a previous `await` - these should be wrapped in `Promise.all()`. Furthermore, verify if higher-level controllers (like routes) are duplicating work that is already performed by lower-level functions.
## 2025-05-15 - Double Serialization in Redis Cache
**Learning:** I discovered that `backend/src/services/statsCache.ts` was stringifying the `payload` object BEFORE adding it to the cache entry wrapper, which was then stringified again. This resulted in double serialization (string inside string), wasting CPU cycles and bytes (escaped quotes). Interestingly, `backend/src/services/redis.ts` already had the optimized implementation, but `statsCache.ts` (which is specific to player stats) re-implemented it inefficiently.
**Action:** When working with Redis or any storage wrapper, always check if the wrapper handles serialization. If so, pass objects directly. Also, look for "parallel" implementations of similar logic in the codebase (`statsCache.ts` vs `redis.ts`) as they often diverge in quality.

## 2025-05-15 - Efficient Object Aggregation
**Learning:** In `backend/src/services/hypixel.ts`, iterating over a large stats object (~10k keys) using `Object.entries(stats)` combined with `key.startsWith(prefix)` inside a loop called multiple times (4x per game mode) was extremely inefficient (O(M*N) + allocation). Switching to a single pass using `for (const key in stats)` reduced execution time by ~10x (29ms -> 2.8ms).
**Action:** When aggregating data from large objects (like Hypixel API responses), avoid `Object.entries` if you just need to scan keys. Use a single pass `for..in` loop to calculate multiple aggregates simultaneously, avoiding repeated scans and intermediate array allocations.
