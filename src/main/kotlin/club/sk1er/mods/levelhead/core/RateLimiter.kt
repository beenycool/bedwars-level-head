package club.sk1er.mods.levelhead.core

import club.sk1er.mods.levelhead.Levelhead
import java.time.Duration
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.atomic.AtomicReference

/**
 * Handles rate limiting for API requests to Hypixel and the proxy.
 * Tracks local token consumption and respects server-side cooldown hints.
 */
class RateLimiter(private val limit: Int, private val window: Duration) {
    private data class RateState(val remaining: Int, val lastResetAt: Long)

    private val state = AtomicReference(RateState(limit, System.currentTimeMillis()))
    private val serverCooldownUntil = AtomicLong(0L)

    /**
     * Consumes a single token from the rate limiter.
     * If no tokens are available or a server cooldown is active, notifies Levelhead.
     */
    fun consume() {
        val now = System.currentTimeMillis()

        // Handle server cooldown
        val cooldown = serverCooldownUntil.get()
        if (now < cooldown) {
            ensureReset(now)
            Levelhead.onRateLimiterBlocked(metricsSnapshot())
            return
        }

        while (true) {
            val current = ensureReset(now)
            if (current.remaining <= 0) {
                Levelhead.onRateLimiterBlocked(metricsSnapshot())
                return
            }

            val newState = current.copy(remaining = current.remaining - 1)
            if (state.compareAndSet(current, newState)) {
                return
            }
        }
    }

    /**
     * Resets the rate limiter state, including tokens and cooldowns.
     */
    fun resetState() {
        state.set(RateState(limit, System.currentTimeMillis()))
        serverCooldownUntil.set(0L)
        Levelhead.resetRateLimiterNotification()
    }

    private fun ensureReset(now: Long): RateState {
        while (true) {
            val current = state.get()
            if (now - current.lastResetAt < window.toMillis()) {
                return current
            }
            val newState = RateState(limit, now)
            if (state.compareAndSet(current, newState)) {
                Levelhead.resetRateLimiterNotification()
                return newState
            }
        }
    }

    /**
     * Returns a snapshot of the current rate limiter metrics.
     * This method is pure and does not trigger resets or notifications.
     */
    fun metricsSnapshot(): Metrics {
        val now = System.currentTimeMillis()
        val current = state.get()

        val resetAt = current.lastResetAt
        val resetIn = Duration.ofMillis((resetAt + window.toMillis() - now).coerceAtLeast(0))
        val serverCooldown = serverCooldownUntil.get().takeIf { it > now }?.let { Duration.ofMillis(it - now) }

        return Metrics(current.remaining, resetIn, serverCooldown)
    }

    /**
     * Registers a cooldown period requested by the server.
     * @param duration The duration of the cooldown.
     * @param silent If true, does not trigger a chat notification.
     */
    fun registerServerCooldown(duration: Duration, silent: Boolean = false) {
        val now = System.currentTimeMillis()
        val until = now + duration.toMillis()
        serverCooldownUntil.set(until)
        if (!silent) {
            ensureReset(now)
            Levelhead.onRateLimiterBlocked(metricsSnapshot())
        }
    }

    /**
     * Snapshot of rate limiter state.
     */
    data class Metrics(
        val remaining: Int,
        val resetIn: Duration,
        val serverCooldown: Duration?
    )
}
