package club.sk1er.mods.levelhead.core

import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

object FetchBackoff {
    private const val BASE_DELAY_MS = 30_000L
    private const val MAX_DELAY_MS = 10 * 60_000L
    private const val CACHE_ONLY_DELAY_MS = 5 * 60_000L
    private const val MAX_TRACKED_PLAYERS = 5_000

    private data class State(
        @Volatile var failures: Int,
        @Volatile var nextAttemptAt: Long,
        @Volatile var cacheOnlyUntil: Long = 0L
    )

    private val players = ConcurrentHashMap<UUID, State>()

    @Volatile
    private var proxyFailures: Int = 0

    @Volatile
    private var proxyNextAttemptAt: Long = 0L

    fun canAttempt(uuid: UUID, now: Long = System.currentTimeMillis()): Boolean {
        val state = players[uuid] ?: return true
        return now >= state.nextAttemptAt && now >= state.cacheOnlyUntil
    }

    fun recordSuccess(uuid: UUID) {
        players.remove(uuid)
    }

    fun recordFailure(uuid: UUID, now: Long = System.currentTimeMillis()) {
        if (players.size > MAX_TRACKED_PLAYERS) {
            players.clear()
        }
        val state = players.computeIfAbsent(uuid) { State(0, 0L) }
        synchronized(state) {
            state.failures += 1
            state.nextAttemptAt = now + delayFor(state.failures)
        }
    }

    /**
     * A cache-only miss means the backend simply has no cached data for this
     * player. Suppress re-asking for a while, but keep it out of the failure
     * counter so it cannot feed the 30s -> 10m doubling.
     */
    fun recordCacheOnlyMiss(uuid: UUID, now: Long = System.currentTimeMillis()) {
        if (players.size > MAX_TRACKED_PLAYERS) {
            players.clear()
        }
        val state = players.computeIfAbsent(uuid) { State(0, 0L) }
        synchronized(state) {
            state.cacheOnlyUntil = maxOf(state.cacheOnlyUntil, now + CACHE_ONLY_DELAY_MS)
        }
    }

    fun proxyReady(now: Long = System.currentTimeMillis()): Boolean = now >= proxyNextAttemptAt

    fun recordProxySuccess() {
        proxyFailures = 0
        proxyNextAttemptAt = 0L
    }

    fun recordProxyFailure(now: Long = System.currentTimeMillis()) {
        proxyFailures += 1
        proxyNextAttemptAt = now + delayFor(proxyFailures)
    }

    fun reset() {
        players.clear()
        proxyFailures = 0
        proxyNextAttemptAt = 0L
    }

    private fun delayFor(failures: Int): Long {
        val shift = (failures - 1).coerceIn(0, 5)
        return (BASE_DELAY_MS shl shift).coerceAtMost(MAX_DELAY_MS)
    }
}
