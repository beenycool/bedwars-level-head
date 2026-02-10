package club.sk1er.mods.levelhead.core

import club.sk1er.mods.levelhead.Levelhead
import java.time.Duration
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong

/**
 * Handles rate limiting for API requests to Hypixel and the proxy.
 * Tracks local token consumption and respects server-side cooldown hints.
 */
class RateLimiter(val limit: Int, val window: Duration) {
    private val remainingTokens = AtomicInteger(limit)
    private val lastResetAt = AtomicLong(System.currentTimeMillis())
    private val serverCooldownUntil = AtomicLong(0L)

    /**
     * Consumes a single token from the rate limiter.
     * If no tokens are available or a server cooldown is active, notifies Levelhead.
     */
    fun consume() {
        checkReset()

        val now = System.currentTimeMillis()
        val cooldown = serverCooldownUntil.get()
        if (now < cooldown) {
            Levelhead.onRateLimiterBlocked(metricsSnapshot())
            return
        }

        if (remainingTokens.get() <= 0) {
            Levelhead.onRateLimiterBlocked(metricsSnapshot())
            return
        }

        remainingTokens.decrementAndGet()
    }

    /**
     * Resets the rate limiter state, including tokens and cooldowns.
     */
    fun resetState() {
        remainingTokens.set(limit)
        lastResetAt.set(System.currentTimeMillis())
        serverCooldownUntil.set(0L)
        Levelhead.resetRateLimiterNotification()
    }

    private fun checkReset() {
        val now = System.currentTimeMillis()
        val lastReset = lastResetAt.get()
        if (now - lastReset >= window.toMillis()) {
            if (lastResetAt.compareAndSet(lastReset, now)) {
                remainingTokens.set(limit)
                Levelhead.resetRateLimiterNotification()
            }
        }
    }

    /**
     * Returns a snapshot of the current rate limiter metrics.
     */
    fun metricsSnapshot(): Metrics {
        checkReset()
        val now = System.currentTimeMillis()
        val resetIn = Duration.ofMillis((lastResetAt.get() + window.toMillis() - now).coerceAtLeast(0))
        val serverCooldown = serverCooldownUntil.get().takeIf { it > now }?.let { Duration.ofMillis(it - now) }
        return Metrics(remainingTokens.get(), resetIn, serverCooldown)
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
