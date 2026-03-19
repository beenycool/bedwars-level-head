# Performance Strategy

Engineering documentation for the BedWars Levelhead mod's performance characteristics, budgets, and optimization approach.

## Performance Budget

| Metric | Target | Peak / Limit | Notes |
|---|---|---|---|
| **Tag renders/frame** | ≤80 | 120 | Typical Hypixel lobby has ~60 visible players |
| **Fetches/minute** | ≤30 sustained | 60/min burst on world join | Rate limiter caps at 150/5min = 30/min average |
| **Cache hit rate** | ≥85% steady state | — | Below 70% indicates TTL too aggressive or cache too small |
| **Cache age distribution** | >60% of entries in 1–15 min range | — | Heavy >45min skew means stale data is being served |
| **String width cache** | ~100% hit rate | — | Only misses on first render after tag value change |
| **Memory (stats cache)** | Bounded at 10,000 entries max | — | Caffeine W-TinyLFU eviction |
| **Memory (display cache)** | WeakHashMap/LRU capped at 500 | — | — |

## Existing Optimizations

### 1. Caffeine Cache (StatsRepository)

W-TinyLFU eviction policy with O(1) amortized lookups, bounded to a configurable maximum size (hard cap 10k entries). No sorting or snapshot overhead — entries are evicted by frequency/recency automatically.

### 2. Per-Frame Tab Precomputation (TabRender.beginFrame)

Resolves all player strings and widths once per frame rather than once per player. Eliminates redundant work when rendering the tab list.

### 3. Cached String Widths (LevelheadComponent.getWidth)

String widths are lazily computed and cached, invalidated only when the tag value changes. Avoids calling `FontRenderer.getStringWidth` every frame for every visible tag.

### 4. Request Deduplication (FetchExecutor.ensureStatsFetch)

A `ConcurrentHashMap` of in-flight `Deferred` objects prevents duplicate concurrent HTTP requests for the same UUID+mode combination. If a fetch is already in progress, callers receive the existing future.

### 5. Bounded Fetch Concurrency (Semaphore(6))

A semaphore limits parallel upstream HTTP calls to 6. Prevents thread exhaustion and excessive connection usage under burst load (e.g., world join with many players).

### 6. Proxy Batch Fetching

UUIDs are grouped into chunks of 10 for batch proxy requests, reducing the number of HTTP round-trips when populating the cache for a lobby.

### 7. Rate Limiter

Token bucket algorithm (150 tokens / 5 minutes) with server cooldown respect. Prevents API abuse and ensures the mod stays within upstream rate limits even during rapid world transitions.

## Debug Counters

The `/levelhead perf` command exposes runtime performance metrics:

| Counter | Description |
|---|---|
| **Tag renders/frame (last)** | Number of tags rendered in the most recent frame |
| **Tag renders/frame (peak)** | Highest tag render count observed since last reset |
| **Fetches/minute** | Rolling 60-second window of HTTP fetch count |
| **Cache hit rate (lifetime)** | Cumulative hit / (hit + miss) ratio since mod startup |
| **Cache age distribution** | Entry count across 5 buckets: <1min, 1–5min, 5–15min, 15–45min, >45min |

## When to Investigate

| Symptom | Threshold | Likely Cause |
|---|---|---|
| Hit rate drops | Below 70% | TTL too aggressive or cache size too small |
| Fetches/minute elevated | Exceeds 45 sustained | Rapid world joins or config changes triggering re-fetches |
| Tag renders/frame high | Exceeds 100 | Render distance too high or excessive entity count |
| Age distribution skewed old | Heavy >45min bucket | Cache is going stale; consider lowering TTL |
