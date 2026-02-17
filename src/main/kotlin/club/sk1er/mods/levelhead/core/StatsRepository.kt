package club.sk1er.mods.levelhead.core

import java.time.Duration
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
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

class StatsRepository(private val maxSizeProvider: () -> Int) {
    private val cache = ConcurrentHashMap<StatsCacheKey, GameStats>()
    private val metrics = StatsCacheMetrics()

    fun get(uuid: UUID, mode: GameMode): GameStats? {
        return cache[StatsCacheKey(uuid, mode)]
    }

    fun getIfFresh(uuid: UUID, mode: GameMode, ttl: Duration, now: Long = System.currentTimeMillis()): GameStats? {
        val key = StatsCacheKey(uuid, mode)
        val entry = cache[key]
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
        return cache[StatsCacheKey(uuid, mode)]
    }

    fun put(uuid: UUID, mode: GameMode, stats: GameStats) {
        cache[StatsCacheKey(uuid, mode)] = stats
    }

    fun trimIfNeeded(ttl: Duration, now: Long = System.currentTimeMillis()) {
        if (cache.size <= maxSizeProvider()) return
        trim(ttl, now)
    }

    fun clear() {
        cache.clear()
    }

    fun size(): Int = cache.size

    fun trim(ttl: Duration, now: Long = System.currentTimeMillis()) {
        val expiredKeys = cache
            .filterValues { it.isExpired(ttl, now) }
            .keys
        expiredKeys.forEach { cache.remove(it) }

        val maxCacheSize = maxSizeProvider()
        if (cache.size <= maxCacheSize) return

        val entriesSnapshot = cache.entries.toList()
        val overflow = entriesSnapshot.size - maxCacheSize
        if (overflow <= 0) return

        entriesSnapshot
            .sortedBy { it.value.fetchedAt }
            .take(overflow)
            .forEach { cache.remove(it.key) }
    }

    fun metricsSnapshot(): StatsCacheSnapshot = metrics.snapshot()

    fun resetMetrics() {
        metrics.reset()
    }

    fun recordMiss(reason: CacheMissReason) {
        metrics.recordMiss(reason)
    }
}
