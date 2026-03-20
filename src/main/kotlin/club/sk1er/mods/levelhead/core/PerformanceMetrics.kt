package club.sk1er.mods.levelhead.core

import java.util.concurrent.atomic.AtomicLong

data class PerfSnapshot(
    val tagRendersLastFrame: Int,
    val peakTagRendersPerFrame: Int,
    val fetchesPerMinute: Double,
    val totalFetches: Long,
    val cacheHitRatePercent: Double,
    val cacheHits: Long,
    val cacheLookups: Long,
    val ageUnder1m: Long,
    val age1to5m: Long,
    val age5to15m: Long,
    val age15to45m: Long,
    val ageOver45m: Long,
)

object PerformanceMetrics {

    private const val WINDOW_MILLIS = 60_000L

    // Tag renders – single-threaded render path, no atomics needed
    @Volatile
    var tagRendersThisFrame: Int = 0
        private set

    @Volatile
    var tagRendersLastFrame: Int = 0
        private set

    @Volatile
    var peakTagRendersPerFrame: Int = 0
        private set

    // Fetches per minute
    val totalFetches = AtomicLong(0L)

    @Volatile
    var fetchWindowStart: Long = System.currentTimeMillis()
        private set

    val fetchesInWindow = AtomicLong(0L)

    // Cache hit rate
    val cacheHits = AtomicLong(0L)
    val cacheLookups = AtomicLong(0L)

    // Cache age distribution buckets
    private val ageUnder1m = AtomicLong(0L)
    private val age1to5m = AtomicLong(0L)
    private val age5to15m = AtomicLong(0L)
    private val age15to45m = AtomicLong(0L)
    private val ageOver45m = AtomicLong(0L)

    fun recordTagRender() {
        tagRendersThisFrame++
    }

    fun onFrameBoundary() {
        val renders = tagRendersThisFrame
        tagRendersLastFrame = renders
        if (renders > peakTagRendersPerFrame) {
            peakTagRendersPerFrame = renders
        }
        tagRendersThisFrame = 0
    }

    fun recordFetch() {
        totalFetches.incrementAndGet()
        rollWindowIfNeeded()
        fetchesInWindow.incrementAndGet()
    }

    private fun rollWindowIfNeeded() {
        val now = System.currentTimeMillis()
        if (now - fetchWindowStart >= WINDOW_MILLIS) {
            fetchWindowStart = now
            fetchesInWindow.set(0L)
        }
    }

    fun recordCacheLookup(hit: Boolean) {
        cacheLookups.incrementAndGet()
        if (hit) {
            cacheHits.incrementAndGet()
        }
    }

    fun recordCacheAge(ageMillis: Long) {
        when {
            ageMillis < 60_000L -> ageUnder1m.incrementAndGet()
            ageMillis < 300_000L -> age1to5m.incrementAndGet()
            ageMillis < 900_000L -> age5to15m.incrementAndGet()
            ageMillis < 2_700_000L -> age15to45m.incrementAndGet()
            else -> ageOver45m.incrementAndGet()
        }
    }

    fun fetchesPerMinute(): Double {
        val elapsed = System.currentTimeMillis() - fetchWindowStart
        if (elapsed <= 0) return 0.0
        val count = fetchesInWindow.get()
        return count.toDouble() / elapsed * WINDOW_MILLIS
    }

    fun hitRatePercent(): Double {
        val lookups = cacheLookups.get()
        if (lookups == 0L) return 0.0
        return cacheHits.get().toDouble() / lookups * 100.0
    }

    fun snapshot(): PerfSnapshot = PerfSnapshot(
        tagRendersLastFrame = tagRendersLastFrame,
        peakTagRendersPerFrame = peakTagRendersPerFrame,
        fetchesPerMinute = fetchesPerMinute(),
        totalFetches = totalFetches.get(),
        cacheHitRatePercent = hitRatePercent(),
        cacheHits = cacheHits.get(),
        cacheLookups = cacheLookups.get(),
        ageUnder1m = ageUnder1m.get(),
        age1to5m = age1to5m.get(),
        age5to15m = age5to15m.get(),
        age15to45m = age15to45m.get(),
        ageOver45m = ageOver45m.get(),
    )

    fun reset() {
        tagRendersThisFrame = 0
        tagRendersLastFrame = 0
        peakTagRendersPerFrame = 0
        totalFetches.set(0L)
        fetchWindowStart = System.currentTimeMillis()
        fetchesInWindow.set(0L)
        cacheHits.set(0L)
        cacheLookups.set(0L)
        ageUnder1m.set(0L)
        age1to5m.set(0L)
        age5to15m.set(0L)
        age15to45m.set(0L)
        ageOver45m.set(0L)
    }
}
