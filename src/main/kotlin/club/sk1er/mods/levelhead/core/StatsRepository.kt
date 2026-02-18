package club.sk1er.mods.levelhead.core

import com.github.benmanes.caffeine.cache.Caffeine
import java.time.Duration
import java.util.UUID
import java.util.concurrent.atomic.AtomicLong

data class StatsCacheKey(val uuid: UUID, val gameMode: GameMode)

data class StatsCacheSnapshot(val cold: Long, val expired: Long)

enum class CacheMissReason { COLD, EXPIRED }

class StatsCacheMetrics {
    private val coldMisses = AtomicLong(0L)
    private val expiredMisses = AtomicLong(0L)

    fun recordMiss(reason: CacheMissReason) {
        when (reason) {
            CacheMissReason.COLD -> coldMisses.incrementAndGet()
            CacheMissReason.EXPIRED -> expiredMisses.incrementAndGet()
        }
    }

    fun reset() {
        coldMisses.set(0L)
        expiredMisses.set(0L)
    }

    fun snapshot(): StatsCacheSnapshot {
        return StatsCacheSnapshot(coldMisses.get(), expiredMisses.get())
    }
}

/**
 * Bounded, thread-safe cache for [GameStats] keyed by (UUID, GameMode).
 *
 * Backed by a Caffeine cache with W-TinyLFU eviction so that size-bounding is O(1)
 * amortised — no map snapshots, no sorting, no intermediate allocations.
 *
 * [maxSizeProvider] is consulted once at construction time to set the Caffeine
 * `maximumSize`. If the user changes `purgeSize` at runtime the effective ceiling
 * follows the next repository instance (created on mod reload). A hard safety cap
 * of 10,000 entries is applied regardless of the configured value.
 *
 * The [trimIfNeeded] / [trim] methods are retained for API compatibility but now
 * simply call [com.github.benmanes.caffeine.cache.Cache.cleanUp] so Caffeine can
 * complete any pending evictions; the O(n log n) sort-and-remove path is gone.
 */
class StatsRepository(private val maxSizeProvider: () -> Int) {
    private val maxSize: Long = maxSizeProvider().toLong().coerceIn(1L, 10_000L)

    private val cache = Caffeine.newBuilder()
        .maximumSize(maxSize)
        .build<StatsCacheKey, GameStats>()

    private val metrics = StatsCacheMetrics()

    fun get(uuid: UUID, mode: GameMode): GameStats? {
        return cache.getIfPresent(StatsCacheKey(uuid, mode))
    }

    fun getIfFresh(uuid: UUID, mode: GameMode, ttl: Duration, now: Long = System.currentTimeMillis()): GameStats? {
        val key = StatsCacheKey(uuid, mode)
        val entry = cache.getIfPresent(key)
        if (entry == null) {
            metrics.recordMiss(CacheMissReason.COLD)
            return null
        }
        if (entry.isExpired(ttl, now)) {
            metrics.recordMiss(CacheMissReason.EXPIRED)
            return null
        }
        return entry
    }

    fun peek(uuid: UUID, mode: GameMode): GameStats? {
        return cache.getIfPresent(StatsCacheKey(uuid, mode))
    }

    fun put(uuid: UUID, mode: GameMode, stats: GameStats) {
        cache.put(StatsCacheKey(uuid, mode), stats)
    }

    /**
     * Runs pending Caffeine maintenance (eviction of entries that exceeded
     * [maxSize]). The TTL-expired entries are not automatically evicted by
     * Caffeine here because no `expireAfter` policy was configured — freshness
     * is checked explicitly in [getIfFresh]. This is intentional: the caller
     * controls TTL policy per lookup.
     */
    fun trimIfNeeded(ttl: Duration, now: Long = System.currentTimeMillis()) {
        cache.cleanUp()
    }

    /** Compatibility alias — drives Caffeine's pending eviction cycle. */
    fun trim(ttl: Duration, now: Long = System.currentTimeMillis()) {
        cache.cleanUp()
    }

    fun clear() {
        cache.invalidateAll()
    }

    fun size(): Int = cache.estimatedSize().toInt()

    fun metricsSnapshot(): StatsCacheSnapshot = metrics.snapshot()

    fun resetMetrics() {
        metrics.reset()
    }

    fun recordMiss(reason: CacheMissReason) {
        metrics.recordMiss(reason)
    }
}
