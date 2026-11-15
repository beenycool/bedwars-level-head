package club.sk1er.mods.levelhead.core

import java.time.Duration
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.atomic.AtomicReference

/**
 * Snapshot of rate limiter state.
 */
data class RateLimiterMetrics(
    val remaining: Int,
    val resetIn: Duration,
    val serverCooldown: Duration?
)

private data class RateState(val remaining: Int, val lastResetAt: Long)

/**
 * Handles rate limiting for API requests to Hypixel and the proxy.
 * Tracks local token consumption and respects server-side cooldown hints.
 *
 * [tryAcquire] is the only way a caller may learn whether it is allowed to send a
 * request. It returns `false` while a server cooldown is active or once the local
 * token budget for the window is exhausted; callers must skip the request in that
 * case. This is what makes the limiter and Retry-After handling real instead of
 * decorative.
 */
class RateLimiter(
    private val limit: Int,
    private val window: Duration,
    private val onBlocked: (RateLimiterMetrics) -> Unit,
    private val onReset: () -> Unit
) {

    private val state = AtomicReference(RateState(limit, System.currentTimeMillis()))
    private val serverCooldownUntil = AtomicLong(0L)
    private val silentCooldown = AtomicLong(0L)

    /**
     * Attempts to consume [tokens] from the budget.
     *
     * @return true when the caller may send the request; false when it must not.
     * A batch costs one token per identifier, matching the backend contract.
     */
    fun tryAcquire(tokens: Int = 1): Boolean {
        val cost = tokens.coerceAtLeast(1)
        val now = System.currentTimeMillis()

        // Handle server cooldown: a Retry-After must actually pause requests.
        val cooldown = serverCooldownUntil.get()
        if (now < cooldown) {
            if (silentCooldown.get() <= now) {
                onBlocked(metricsSnapshot())
            }
            return false
        }

        while (true) {
            val current = ensureReset(now)
            if (current.remaining < cost) {
                onBlocked(metricsSnapshot())
                return false
            }

            val newState = current.copy(remaining = current.remaining - cost)
            if (state.compareAndSet(current, newState)) {
                return true
            }
        }
    }

    /**
     * Backwards-compatible name for [tryAcquire]. The return value is a real
     * decision: callers that send on `false` are the bug this method exists to
     * prevent.
     */
    fun consume(): Boolean = tryAcquire()

    /** True while a server-requested cooldown is active. */
    fun isCoolingDown(now: Long = System.currentTimeMillis()): Boolean = now < serverCooldownUntil.get()

    /**
     * Resets the rate limiter state, including tokens and cooldowns.
     * Deliberately not called on world joins: lobby hops must not refill the token
     * budget or forget a 60 s Retry-After.
     */
    fun resetState() {
        state.set(RateState(limit, System.currentTimeMillis()))
        serverCooldownUntil.set(0L)
        silentCooldown.set(0L)
        onReset()
    }

    private fun ensureReset(now: Long): RateState {
        while (true) {
            val current = state.get()
            if (now - current.lastResetAt < window.toMillis()) {
                return current
            }
            val newState = RateState(limit, now)
            if (state.compareAndSet(current, newState)) {
                onReset()
                return newState
            }
        }
    }

    /**
     * Returns a snapshot of the current rate limiter metrics.
     * This method is pure and does not trigger resets or notifications.
     */
    fun metricsSnapshot(): RateLimiterMetrics {
        val now = System.currentTimeMillis()
        val current = state.get()

        val resetAt = current.lastResetAt
        val resetIn = Duration.ofMillis((resetAt + window.toMillis() - now).coerceAtLeast(0))
        val serverCooldown = serverCooldownUntil.get().takeIf { it > now }?.let { Duration.ofMillis(it - now) }

        return RateLimiterMetrics(current.remaining, resetIn, serverCooldown)
    }

    /**
     * Registers a cooldown period requested by the server.
     * @param duration The duration of the cooldown.
     * @param silent If true, does not trigger a blocked notification callback.
     */
    fun registerServerCooldown(duration: Duration, silent: Boolean = false) {
        val now = System.currentTimeMillis()
        val until = now + duration.toMillis()
        // Never shorten an active cooldown: a shorter Retry-After from a different
        // endpoint must not reopen the gate early.
        serverCooldownUntil.accumulateAndGet(until) { current, candidate -> maxOf(current, candidate) }
        if (silent) {
            silentCooldown.accumulateAndGet(until) { current, candidate -> maxOf(current, candidate) }
        } else {
            silentCooldown.set(0L)
            ensureReset(now)
            onBlocked(metricsSnapshot())
        }
    }
}
