package club.sk1er.mods.levelhead.core

import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertDoesNotThrow
import java.time.Duration

class RateLimiterTest {

    @Test
    fun `consume decrements remaining tokens`() {
        val blockedCalls = mutableListOf<RateLimiterMetrics>()
        val resetCalls = mutableListOf<Unit>()

        val limiter = RateLimiter(
            limit = 5,
            window = Duration.ofMinutes(1),
            onBlocked = { blockedCalls.add(it) },
            onReset = { resetCalls.add(Unit) }
        )

        // Consume 3 tokens
        limiter.consume()
        limiter.consume()
        limiter.consume()

        // Verify remaining is 2 (5 - 3 = 2)
        val metrics = limiter.metricsSnapshot()
        assertEquals(2, metrics.remaining)
        assertEquals(0, blockedCalls.size)
    }

    @Test
    fun `consume triggers blocked callback when no tokens available`() {
        val blockedCalls = mutableListOf<RateLimiterMetrics>()
        val resetCalls = mutableListOf<Unit>()

        val limiter = RateLimiter(
            limit = 2,
            window = Duration.ofMinutes(1),
            onBlocked = { blockedCalls.add(it) },
            onReset = { resetCalls.add(Unit) }
        )

        // Consume all tokens
        limiter.consume()
        limiter.consume()

        // Next consume should be blocked
        limiter.consume()

        assertEquals(1, blockedCalls.size)
        assertEquals(0, blockedCalls[0].remaining)
    }

    @Test
    fun `reset restores remaining tokens to limit`() {
        val blockedCalls = mutableListOf<RateLimiterMetrics>()
        val resetCalls = mutableListOf<Unit>()

        val limiter = RateLimiter(
            limit = 5,
            window = Duration.ofMinutes(1),
            onBlocked = { blockedCalls.add(it) },
            onReset = { resetCalls.add(Unit) }
        )

        // Consume some tokens
        limiter.consume()
        limiter.consume()

        // Verify remaining is reduced
        assertEquals(3, limiter.metricsSnapshot().remaining)

        // Reset
        limiter.resetState()

        // Verify remaining is restored to limit
        assertEquals(5, limiter.metricsSnapshot().remaining)
        assertEquals(1, resetCalls.size)
    }

    @Test
    fun `server cooldown blocks consume calls`() {
        val blockedCalls = mutableListOf<RateLimiterMetrics>()
        val resetCalls = mutableListOf<Unit>()

        val limiter = RateLimiter(
            limit = 5,
            window = Duration.ofMinutes(1),
            onBlocked = { blockedCalls.add(it) },
            onReset = { resetCalls.add(Unit) }
        )

        // Register a server cooldown for 1 minute
        limiter.registerServerCooldown(Duration.ofMinutes(1), silent = false)

        // Try to consume - should be blocked due to cooldown
        limiter.consume()

        // Should have been blocked
        assertTrue(blockedCalls.isNotEmpty())
        assertNotNull(blockedCalls[0].serverCooldown)
    }

    @Test
    fun `server cooldown with silent flag does not trigger blocked callback`() {
        val blockedCalls = mutableListOf<RateLimiterMetrics>()
        val resetCalls = mutableListOf<Unit>()

        val limiter = RateLimiter(
            limit = 5,
            window = Duration.ofMinutes(1),
            onBlocked = { blockedCalls.add(it) },
            onReset = { resetCalls.add(Unit) }
        )

        // Register a server cooldown silently
        limiter.registerServerCooldown(Duration.ofMinutes(1), silent = true)

        // Try to consume - should be blocked due to cooldown but callback should NOT be invoked
        limiter.consume()

        // With silent=true, the blocked callback should NOT be called
        assertEquals(0, blockedCalls.size)
    }

    @Test
    fun `metricsSnapshot returns correct values`() {
        val blockedCalls = mutableListOf<RateLimiterMetrics>()
        val resetCalls = mutableListOf<Unit>()

        val limiter = RateLimiter(
            limit = 10,
            window = Duration.ofMinutes(5),
            onBlocked = { blockedCalls.add(it) },
            onReset = { resetCalls.add(Unit) }
        )

        // Consume 7 tokens
        repeat(7) { limiter.consume() }

        val metrics = limiter.metricsSnapshot()

        assertEquals(3, metrics.remaining) // 10 - 7 = 3
        assertTrue(metrics.resetIn.toMillis() > 0)
        assertNull(metrics.serverCooldown)
    }

    @Test
    fun `sequential consumes decrement tokens correctly`() {
        val blockedCalls = mutableListOf<RateLimiterMetrics>()
        val resetCalls = mutableListOf<Unit>()

        val limiter = RateLimiter(
            limit = 100,
            window = Duration.ofMinutes(1),
            onBlocked = { blockedCalls.add(it) },
            onReset = { resetCalls.add(Unit) }
        )

        // Consume tokens sequentially
        repeat(50) { limiter.consume() }

        assertEquals(0, blockedCalls.size)
        assertEquals(50, limiter.metricsSnapshot().remaining)
    }

    @Test
    fun `consume with zero limit immediately blocks`() {
        val blockedCalls = mutableListOf<RateLimiterMetrics>()
        val resetCalls = mutableListOf<Unit>()

        val limiter = RateLimiter(
            limit = 0,
            window = Duration.ofMinutes(1),
            onBlocked = { blockedCalls.add(it) },
            onReset = { resetCalls.add(Unit) }
        )

        // Try to consume - should be blocked immediately
        limiter.consume()

        assertEquals(1, blockedCalls.size)
        assertEquals(0, blockedCalls[0].remaining)
    }
}
