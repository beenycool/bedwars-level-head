# Bolt learnings

## 2024-05-19 - Avoid Spread Syntax with Math.min/max on Large Arrays

**Learning:** In Node.js backend code, using `Math.min(...array)` or `Math.max(...array)` on potentially large datasets (like thousands of timestamps in stats charting) can cause a "Maximum call stack size exceeded" error. This is because the spread operator (`...`) pushes every element of the array onto the JavaScript engine's call stack as function arguments. This also consumes O(N) memory temporarily. Combined with chained array operations like `.map().filter()`, this creates unnecessary GC pressure and a vector for crashes.

**Action:** Always replace chained `.map().filter()` combined with `Math.min(...array)` or `Math.max(...array)` with a single, O(N) `for` loop that safely tracks minimum and maximum values using O(1) memory, ensuring stability on unbounded or large data inputs.

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

## 2025-05-16 - Stateful Regex in Fast-Paths

**Learning:** Using a global regular expression (`/pattern/g`) with `.test()` as a fast-path condition before a `.replace()` mutates the `lastIndex` property of the regex object. If the same global regex object is reused across function calls, subsequent `.test()` checks will resume from `lastIndex` and potentially fail on valid matches, causing stateful bugs.

**Action:** In high-traffic string manipulation functions (like `escapeHtml`), use a non-global regex with `.test()` as a fast-path check before executing heavier `.replace()` operations to prevent unnecessary string allocations. Ensure this fast-path regex is non-global to avoid mutating the `.lastIndex` property.

## 2025-05-16 - CSV Export Memory Allocation Overhead

**Learning:** During backend background or heavy-throughput operations, nested `.map()` array operations combined with string `.join(',')` operations cause a large number of intermediate memory allocations. Specifically in `backend/src/util/csv.ts`, parsing a 10,000-row `data` array with 14 keys created ~10,000 intermediate arrays (one for `headers.map` inside `data.map`) that were immediately garbage collected, creating massive V8 GC pressure and high memory spikes during CSV export.

**Action:** When repeatedly mapping headers/columns over large datasets, completely replace `Array.prototype.map` inside the row iteration loop with a standard O(N) `for` loop that concatenates primitive strings directly (or pushes to a pre-allocated array).

## 2024-05-19 - Array Allocations and Reductions in Aggregation Loops

**Learning:** Using chained higher-order array functions like `.map().sort()` inside frequently called loops (like `aggregateToBuckets` which runs on arrays of thousands of memory/cpu samples) forces the engine to allocate multiple intermediate O(N) arrays per iteration. Similarly, using `.reduce()` for simple aggregations (`Math.max`, `Math.min`, `sum`) creates an intermediate accumulator object and invokes a callback per element, creating hidden GC pressure and CPU overhead on hot paths.

**Action:** Replace chained array methods with a single loop that extracts values into pre-allocated arrays, then sort the primitive arrays. Replace `.reduce()` calls with simple `for` loops to eliminate callback overhead and intermediate object allocation.

## 2024-05-19 - Redundant Sorting in Multiple Percentile Calculations

**Learning:** In `backend/src/routes/stats.ts`, the `percentile` function was implemented to copy and sort the input array (`[...values].sort(...)`) every time it was called. When calculating multiple percentiles (e.g., p50, p95, p99) or deriving `min`/`max` from the same latency dataset containing thousands of points, this resulted in executing multiple $O(N \log N)$ sort operations and allocating redundant array copies, significantly slowing down dashboard metric generation.

**Action:** When calculating multiple percentiles or math aggregations from a dataset, ensure the array is sorted exactly once beforehand. Change utility functions to accept and expect pre-sorted arrays to eliminate redundant $O(N \log N)$ sorting overhead and GC pressure.

## 2024-05-19 - Safe Array Optimization

**Learning:** Using a raw JS object (`Record<string, boolean>`) for uniqueness checks introduces vulnerabilities to Object prototype property collisions (e.g., valid strings matching "toString" or "constructor"), causing valid user input to be silently dropped.

**Action:** Always use `new Set()` and `.has()` for safe and performant string uniqueness tracking, even when attempting to optimize array operations.

## 2024-05-19 - High-Throughput Aggregation Optimization

**Learning:** While `Array.prototype.reduce()` is idiomatic, it incurs callback invocation overhead on each iteration, which can degrade client-side performance during aggregations over large datasets (like computing total requests or average cache rates in `stats.ts`).

**Action:** Replace `.reduce()` aggregations with standard `for` loops in hot paths to avoid closure allocations and callback overhead.

## 2024-05-19 - Promise.all with .map() Array Allocation Overhead

**Learning:** Using `Promise.all(array.map(async () => ...))` in high-throughput or batch processing routes (like `/api/player/batch` and `/api/public/player/batch`) inherently allocates a new intermediate array and creates closure overhead for every element due to `.map()`. In hot paths, this creates unnecessary O(N) memory allocations and increases Garbage Collection pressure.

**Action:** Replace `.map()` wrapped in `Promise.all()` with a pre-allocated array (`new Array(length)`) and a standard `for` loop to manually iterate and assign promises. This eliminates the intermediate array allocation and closure overhead natively generated by `.map()`.

## 2024-05-16 - Array Iteration Hot Path Optimization

**Learning:** In the Express batch route implementations (`backend/src/routes/player.ts` and `backend/src/routes/playerPublic.ts`), building the payload object using `results.forEach((result) => {...})` creates significant memory GC pressure when looping over dozens of concurrent payload maps. Calling `.forEach` requires instantiating an intermediate function closure on every loop array, generating hidden O(N) allocations for high-throughput loops.

**Action:** In Node.js backend projects, optimize high-throughput array processing by replacing `.forEach` calls with a simple `for` loop to eliminate intermediate memory allocations and reduce GC pressure.

## 2025-01-26 - Optimize toCSV to use direct string concatenation

**Learning:** For generating large strings like CSV or text reports, `Array.map().join('\n')` or pushing to a pre-allocated array followed by `.join('\n')` creates O(N) intermediate array allocations, increasing GC pressure.

**Action:** Replace intermediate array allocations and `.join('\n')` with direct string concatenation (`+=`) in hot paths where large strings are built iteratively.

## 2025-10-27 - Array mapping and creation overheads in Express routes

**Learning:** When using `.map()` on arrays that are fetched from cache, databases, or inside loop structures for endpoints handling dynamic requests, Node.js has to allocate new intermediate array references for mapping over elements, generating O(N) short-lived objects. Combined with `.forEach()` or similar functional array aggregators, this introduces latency and overhead.

**Action:** Replace `.map()` allocations inside frequently hit components, specifically those like the express api batch routes, cron routes, and api stat endpoints, and `.forEach()` with pre-allocated arrays `new Array(size)` and simple `for` loops respectively to minimize transient object generation and GC delays.

## 2024-11-20 - Unmeasurable Micro-Optimizations in Cryptographic Paths

**Learning:** Replacing `.reduce()` with a `for` loop to avoid closure invocation overhead yields technically faster execution, but is entirely unmeasurable in paths dominated by heavily CPU-bound operations like cryptographic hashing (e.g., `crypto.scryptSync()`). The time spent in the cryptographic function eclipses any saved closure overhead by orders of magnitude.

**Action:** Before optimizing array operations (like `.reduce()`, `.map()`, `.filter()`), ensure the surrounding context doesn't contain inherently slow or computationally expensive operations that render the optimization meaningless. Focus array optimizations exclusively on hot paths devoid of heavy crypto or I/O operations.

## 2026-04-17 - Prevent ASI breakage with JSON parsing

**Learning:** In ESBuild output, interpolating `JSON.stringify(data)` into a template string in Node script blocks can break code if ASI decides that the `{"json": "content"}` object was meant to evaluate, then missing a semicolon breaks syntax execution logic resulting in `jsonForFrontend.filter is not a function`.

**Action:** When injecting backend JSON into inline template strings (e.g. `const html = \`…\``-style template literals), wrap the payload in `JSON.parse(decodeURIComponent("..."))` rather than interpolating raw object syntax.
