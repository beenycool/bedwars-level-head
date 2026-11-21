package club.sk1er.mods.levelhead.core

import java.time.Duration
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicLong

data class StatsKey(val uuid: UUID, val gameMode: GameMode)

enum class CacheMissReason { COLD, STALE }

data class StatsCacheSnapshot(val cold: Long, val expired: Long)

enum class StatsLookup {
    HIT,

    STALE,

    MISS
}

class StatsStore(
    private val maxSizeProvider: () -> Int = { DEFAULT_MAX_ENTRIES },
    private val ttlProvider: () -> Duration = { Duration.ofMinutes(DEFAULT_TTL_MINUTES) },
    private val clock: () -> Long = System::currentTimeMillis
) {
    private class Entry(val state: StatsState, val version: Long, @Volatile var access: Long)

    private val maxEntries: Int = runCatching { maxSizeProvider() }
        .getOrDefault(DEFAULT_MAX_ENTRIES)
        .coerceIn(1, HARD_MAX_ENTRIES)

    private val entries = ConcurrentHashMap<StatsKey, Entry>()
    private val accessCounter = AtomicLong(0L)
    private val versionCounter = AtomicLong(0L)
    private val metrics = StatsCacheMetrics()

    fun state(uuid: UUID, gameMode: GameMode): StatsState? = entries[StatsKey(uuid, gameMode)]?.let {
        it.access = accessCounter.incrementAndGet()
        it.state
    }

    fun get(uuid: UUID, gameMode: GameMode): GameStats? = state(uuid, gameMode)?.statsOrNull

    fun version(uuid: UUID, gameMode: GameMode): Long =
        entries[StatsKey(uuid, gameMode)]?.let {
            it.access = accessCounter.incrementAndGet()
            it.version
        } ?: 0L

    fun lookup(uuid: UUID, gameMode: GameMode, now: Long = clock()): StatsLookup {
        val stats = get(uuid, gameMode)
        val result = when {
            stats == null -> StatsLookup.MISS
            stats.isExpired(ttlProvider(), now) -> StatsLookup.STALE
            else -> StatsLookup.HIT
        }
        when (result) {
            StatsLookup.MISS -> metrics.recordMiss(CacheMissReason.COLD)
            StatsLookup.STALE -> metrics.recordMiss(CacheMissReason.STALE)
            StatsLookup.HIT -> Unit
        }
        return result
    }

    fun needsFetch(uuid: UUID, gameMode: GameMode, now: Long = clock()): Boolean {
        val state = state(uuid, gameMode) ?: return true
        if (state is StatsState.Loading) return isStaleLoading(state, now)
        val stats = state.statsOrNull ?: return true
        return stats.isExpired(ttlProvider(), now)
    }

    /** True only for a [StatsState.Loading] placeholder young enough to describe real work. */
    fun isLoading(uuid: UUID, gameMode: GameMode, now: Long = clock()): Boolean {
        val state = state(uuid, gameMode) ?: return false
        return state is StatsState.Loading && !isStaleLoading(state, now)
    }

    fun putSuccess(uuid: UUID, gameMode: GameMode, stats: GameStats, now: Long = clock()) {
        val fetchedAt = stats.fetchedAt.takeIf { it > 0L } ?: now
        val state = if (stats.nicked) {
            StatsState.Nicked(stats, fetchedAt)
        } else {
            StatsState.Ok(stats, fetchedAt)
        }
        put(uuid, gameMode, state)
    }

    /**
     * Record a failed lookup. Existing usable stats are kept: a failed refresh must
     * not throw away the last good tag. When there is nothing to keep, the entry
     * becomes [StatsState.Failed], which renders nothing.
     */
    fun putFailure(uuid: UUID, gameMode: GameMode, nextRetryAt: Long) {
        val key = StatsKey(uuid, gameMode)
        val existing = entries[key]
        if (existing?.state?.statsOrNull != null) {
            existing.access = accessCounter.incrementAndGet()
            return
        }
        val attempts = ((existing?.state as? StatsState.Failed)?.attempts ?: 0) + 1
        put(uuid, gameMode, StatsState.Failed(attempts, nextRetryAt))
    }

    fun markLoading(uuid: UUID, gameMode: GameMode, now: Long = clock()) {
        val key = StatsKey(uuid, gameMode)
        val existing = entries[key]
        if (existing == null) {
            put(uuid, gameMode, StatsState.Loading(now))
            return
        }
        existing.access = accessCounter.incrementAndGet()
        // A Failed retry or a stale entry must actually enter Loading, otherwise
        // isLoading() stays false and the 2 s refresh loops keep re-enqueueing it.
        // Fresh Ok entries and live placeholders are left alone.
        when (val state = existing.state) {
            is StatsState.Loading -> if (isStaleLoading(state, now)) {
                put(uuid, gameMode, StatsState.Loading(now))
            }
            is StatsState.Failed -> put(uuid, gameMode, StatsState.Loading(now))
            is StatsState.Ok -> if (state.stats.isExpired(ttlProvider(), now)) {
                put(uuid, gameMode, StatsState.Loading(now))
            }
            is StatsState.Nicked -> if (state.stats.isExpired(ttlProvider(), now)) {
                put(uuid, gameMode, StatsState.Loading(now))
            }
        }
    }

    /** Explicit refresh only; world joins must not call this. */
    fun clear() {
        entries.clear()
    }

    /**
     * Drop in-flight placeholders whose owning coroutine was cancelled (for example
     * by a world hop). Without this a stranded [StatsState.Loading] would suppress
     * every future request for that player because [needsFetch] treats loading as
     * "already handled".
     */
    fun clearLoading() {
        val iterator = entries.entries.iterator()
        while (iterator.hasNext()) {
            if (iterator.next().value.state is StatsState.Loading) {
                iterator.remove()
            }
        }
    }

    fun size(): Int = entries.size

    fun metricsSnapshot(): StatsCacheSnapshot = metrics.snapshot()

    fun resetMetrics() {
        metrics.reset()
    }

    private fun put(uuid: UUID, gameMode: GameMode, state: StatsState) {
        val key = StatsKey(uuid, gameMode)
        val entry = Entry(state, versionCounter.incrementAndGet(), accessCounter.incrementAndGet())
        entries[key] = entry
        if (entries.size > maxEntries) {
            evictOldest(except = key)
        }
    }

    private fun isStaleLoading(state: StatsState.Loading, now: Long): Boolean =
        now - state.fetchedAt >= LOADING_STALE_MS

    private fun evictOldest(except: StatsKey) {
        val oldest = entries.entries
            .asSequence()
            .filter { it.key != except }
            .minByOrNull { it.value.access }
            ?: return
        entries.remove(oldest.key, oldest.value)
    }

    private companion object {
        const val DEFAULT_MAX_ENTRIES = 500
        const val HARD_MAX_ENTRIES = 10_000
        const val DEFAULT_TTL_MINUTES = 45L
        const val LOADING_STALE_MS = 60_000L
    }
}

sealed class StatsState {
    abstract val fetchedAt: Long

    data class Loading(override val fetchedAt: Long) : StatsState()

    data class Ok(val stats: GameStats, override val fetchedAt: Long) : StatsState()

    data class Failed(val attempts: Int, val nextRetryAt: Long) : StatsState() {
        override val fetchedAt: Long get() = 0L
    }

    data class Nicked(val stats: GameStats, override val fetchedAt: Long) : StatsState()

    val statsOrNull: GameStats?
        get() = when (this) {
            is Ok -> stats
            is Nicked -> stats
            is Loading, is Failed -> null
        }
}

class StatsCacheMetrics {
    private val coldMisses = AtomicLong(0L)
    private val expiredMisses = AtomicLong(0L)

    fun recordMiss(reason: CacheMissReason) {
        when (reason) {
            CacheMissReason.COLD -> coldMisses.incrementAndGet()
            CacheMissReason.STALE -> expiredMisses.incrementAndGet()
        }
    }

    fun reset() {
        coldMisses.set(0L)
        expiredMisses.set(0L)
    }

    fun snapshot(): StatsCacheSnapshot = StatsCacheSnapshot(coldMisses.get(), expiredMisses.get())
}
