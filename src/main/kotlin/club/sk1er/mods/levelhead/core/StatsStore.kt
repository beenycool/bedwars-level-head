package club.sk1er.mods.levelhead.core

import java.time.Duration
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicLong

/** Identity of one lookup: a player in one game mode. */
data class StatsKey(val uuid: UUID, val gameMode: GameMode)

/** Why a lookup had to go to the network. Used by `/levelhead status`. */
enum class CacheMissReason { COLD, STALE }

data class StatsCacheSnapshot(val cold: Long, val expired: Long)

/** Result of asking the store whether a request can be served locally. */
enum class StatsLookup {
    /** Fresh stats are available; no request is needed. */
    HIT,

    /** Stats are available but older than the configured TTL; render them and refresh. */
    STALE,

    /** Nothing usable is stored; a request is needed. */
    MISS
}

/**
 * The single piece of player state in the mod.
 *
 * There used to be four copies of "what is this player's tag": `pendingRequests`,
 * `StatsRepository`, each display's tag cache and the listeners in `CacheApplier`.
 * Each copy was refreshed by a different caller on a different thread, and a failed
 * fetch was written into one of them as a "?" tag. This class replaces all of that
 * with one map keyed by (player, game mode).
 *
 * Threading: written by IO workers, read by the render thread. The map is concurrent
 * and entries are immutable snapshots. Reads are safe from any thread.
 *
 * TTL: entries are retained; [lookup] decides whether they are fresh. The TTL is the
 * only thing that makes a player refetch. There is deliberately no `onWorldJoin`
 * clear: a lobby hop must not throw away half an hour of good data (B11).
 *
 * LRU: a bounded map with access-order eviction. The cap is read once at
 * construction, exactly like the old Caffeine `maximumSize`.
 */
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

    /** Raw state, including [StatsState.Failed] and [StatsState.Loading]. */
    fun state(uuid: UUID, gameMode: GameMode): StatsState? = entries[StatsKey(uuid, gameMode)]?.let {
        it.access = accessCounter.incrementAndGet()
        it.state
    }

    /**
     * Usable stats for rendering: [StatsState.Ok] or [StatsState.Nicked].
     * Never returns anything for a failed or loading lookup, which is what keeps a
     * failure from becoming a "?" tag.
     */
    fun get(uuid: UUID, gameMode: GameMode): GameStats? = state(uuid, gameMode)?.statsOrNull

    /** Monotonic version of the stored value, used to memoise formatted tags. */
    fun version(uuid: UUID, gameMode: GameMode): Long =
        entries[StatsKey(uuid, gameMode)]?.let {
            it.access = accessCounter.incrementAndGet()
            it.version
        } ?: 0L

    /**
     * Classify the entry for the request path. Records the same cold/expired miss
     * counters the old planner exposed.
     */
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

    /** True when the request loops should enqueue this player. */
    fun needsFetch(uuid: UUID, gameMode: GameMode, now: Long = clock()): Boolean =
        lookup(uuid, gameMode, now) != StatsLookup.HIT

    /** Store a successful lookup. A success replaces a failure. */
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

    /** Mark a cold entry as in flight. Never hides stats that are already usable. */
    fun markLoading(uuid: UUID, gameMode: GameMode, now: Long = clock()) {
        val key = StatsKey(uuid, gameMode)
        val existing = entries[key]
        if (existing != null) {
            existing.access = accessCounter.incrementAndGet()
            return
        }
        put(uuid, gameMode, StatsState.Loading(now))
    }

    /** Explicit refresh only; world joins must not call this. */
    fun clear() {
        entries.clear()
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
    }
}

/**
 * One entry in [StatsStore]. A state either carries stats ([Ok], [Nicked]) or
 * explicitly says there is nothing to render ([Loading], [Failed]).
 */
sealed class StatsState {
    abstract val fetchedAt: Long

    /** A request is in flight. Renders nothing until it succeeds. */
    data class Loading(override val fetchedAt: Long) : StatsState()

    /** The last lookup succeeded. */
    data class Ok(val stats: GameStats, override val fetchedAt: Long) : StatsState()

    /** The last lookup failed; [nextRetryAt] comes from [FetchBackoff]. */
    data class Failed(val attempts: Int, val nextRetryAt: Long) : StatsState() {
        override val fetchedAt: Long get() = 0L
    }

    /** The player is nicked. Kept distinct so callers never mistake it for a miss. */
    data class Nicked(val stats: GameStats, override val fetchedAt: Long) : StatsState()

    /** Stats that may be rendered, or null when this state is absence. */
    val statsOrNull: GameStats?
        get() = when (this) {
            is Ok -> stats
            is Nicked -> stats
            is Loading, is Failed -> null
        }
}

/** Counters shown by `/levelhead status`; retained from the old repository. */
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
