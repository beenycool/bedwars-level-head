package club.sk1er.mods.levelhead.core

import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/**
 * Per-player and per-backend retry backoff.
 *
 * Failures used to be invisible: every two-second tab poll re-enqueued every
 * missing player, so a dead backend was hammered at a rate proportional to the
 * tab list size. This object records failures with an exponential delay so the
 * retry loop is bounded instead of a storm.
 *
 * It deliberately survives world joins (a lobby hop must not forget a failing
 * backend) and is only cleared by an explicit user-requested refresh.
 */
object FetchBackoff {
    private const val BASE_DELAY_MS = 30_000L
    private const val MAX_DELAY_MS = 10 * 60_000L
    private const val MAX_TRACKED_PLAYERS = 5_000

    private data class State(@Volatile var failures: Int, @Volatile var nextAttemptAt: Long)

    private val players = ConcurrentHashMap<UUID, State>()

    @Volatile
    private var proxyFailures: Int = 0

    @Volatile
    private var proxyNextAttemptAt: Long = 0L

    /** True when the player may be requested again at [now]. */
    fun canAttempt(uuid: UUID, now: Long = System.currentTimeMillis()): Boolean {
        val state = players[uuid] ?: return true
        return now >= state.nextAttemptAt
    }

    /** When this player may be retried, or null when it has not failed. */
    fun nextAttemptAt(uuid: UUID): Long? = players[uuid]?.nextAttemptAt

    fun recordSuccess(uuid: UUID) {
        players.remove(uuid)
    }

    fun recordFailure(uuid: UUID, now: Long = System.currentTimeMillis()) {
        if (players.size > MAX_TRACKED_PLAYERS) {
            // Cheap safety valve; losing backoff state only costs one extra retry.
            players.clear()
        }
        val state = players.computeIfAbsent(uuid) { State(0, 0L) }
        synchronized(state) {
            state.failures += 1
            state.nextAttemptAt = now + delayFor(state.failures)
        }
    }

    /** True when the proxy may be called again. */
    fun proxyReady(now: Long = System.currentTimeMillis()): Boolean = now >= proxyNextAttemptAt

    fun recordProxySuccess() {
        proxyFailures = 0
        proxyNextAttemptAt = 0L
    }

    fun recordProxyFailure(now: Long = System.currentTimeMillis()) {
        proxyFailures += 1
        proxyNextAttemptAt = now + delayFor(proxyFailures)
    }

    /** Clears all backoff state. Only for an explicit user refresh or tests. */
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
