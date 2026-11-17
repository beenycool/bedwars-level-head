package club.sk1er.mods.levelhead.core

import java.time.Duration
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.atomic.AtomicReference

data class RateLimiterMetrics(
    val remaining: Int,
    val resetIn: Duration,
    val serverCooldown: Duration?
)

private data class RateState(val remaining: Int, val lastResetAt: Long)

class RateLimiter(
    private val limit: Int,
    private val window: Duration,
    private val onBlocked: (RateLimiterMetrics) -> Unit,
    private val onReset: () -> Unit
) {

    private val state = AtomicReference(RateState(limit, System.currentTimeMillis()))
    private val serverCooldownUntil = AtomicLong(0L)
    private val silentCooldown = AtomicLong(0L)

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

    fun isCoolingDown(now: Long = System.currentTimeMillis()): Boolean = now < serverCooldownUntil.get()

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

    fun metricsSnapshot(): RateLimiterMetrics {
        val now = System.currentTimeMillis()
        val current = state.get()

        val resetAt = current.lastResetAt
        val resetIn = Duration.ofMillis((resetAt + window.toMillis() - now).coerceAtLeast(0))
        val serverCooldown = serverCooldownUntil.get().takeIf { it > now }?.let { Duration.ofMillis(it - now) }

        return RateLimiterMetrics(current.remaining, resetIn, serverCooldown)
    }

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
