package club.sk1er.mods.levelhead.core

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.time.Duration

/**
 * The limiter is the gate every outbound request passes through. These tests pin
 * the accounting (tokens, batches), the reset path, and the server-cooldown rules.
 * Where several inputs exercise the same rule they are a table row, and the
 * assertion message names the case.
 */
class RateLimiterTest {

    private val blockedCalls = mutableListOf<RateLimiterMetrics>()
    private val resetCalls = mutableListOf<Unit>()

    private fun limiter(limit: Int, window: Duration = Duration.ofMinutes(1)) = RateLimiter(
        limit = limit,
        window = window,
        onBlocked = { blockedCalls.add(it) },
        onReset = { resetCalls.add(Unit) },
    )

    @Test
    fun `consume spends a token and reports the remaining budget`() {
        val cases = listOf(
            // limit, window, tokens to consume
            Triple(5, Duration.ofMinutes(1), 3),
            Triple(10, Duration.ofMinutes(5), 7),
            Triple(100, Duration.ofMinutes(1), 50),
        )

        cases.forEach { (limit, window, consumed) ->
            blockedCalls.clear()
            val limiter = limiter(limit, window)
            repeat(consumed) { limiter.consume() }

            val metrics = limiter.metricsSnapshot()
            val name = "limit=$limit, window=$window, consumed=$consumed"
            assertEquals(limit - consumed, metrics.remaining, "case: $name / remaining")
            assertEquals(0, blockedCalls.size, "case: $name / must not block")
            assertTrue(metrics.resetIn.toMillis() > 0, "case: $name / resetIn")
            assertNull(metrics.serverCooldown, "case: $name / no cooldown")
        }
    }

    @Test
    fun `consume is blocked once the budget is exhausted`() {
        val cases = listOf(
            Triple(2, 3, "budget of 2, third request"),
            Triple(0, 1, "zero budget"),
        )

        cases.forEach { (limit, attempts, name) ->
            blockedCalls.clear()
            val limiter = limiter(limit)
            repeat(attempts) { limiter.consume() }

            assertEquals(1, blockedCalls.size, "case: $name / blocked callbacks")
            assertEquals(0, blockedCalls.last().remaining, "case: $name / blocked at zero")
        }
    }

    @Test
    fun `reset restores the token budget and notifies once`() {
        val limiter = limiter(5)
        limiter.consume()
        limiter.consume()
        assertEquals(3, limiter.metricsSnapshot().remaining, "case: before reset")

        limiter.resetState()

        assertEquals(5, limiter.metricsSnapshot().remaining, "case: after reset")
        assertEquals(1, resetCalls.size, "case: onReset callbacks")
    }

    @Test
    fun `a server cooldown blocks consume, and silence only suppresses the callback`() {
        // Non-silent: the cooldown is announced and every request is refused.
        val loud = limiter(5)
        loud.registerServerCooldown(Duration.ofMinutes(1), silent = false)
        loud.consume()
        assertTrue(blockedCalls.isNotEmpty(), "case: non-silent cooldown must notify")
        assertNotNull(blockedCalls[0].serverCooldown, "case: non-silent cooldown metrics")

        // Silent: still refused, but nothing is reported to the UI.
        blockedCalls.clear()
        val silent = limiter(5)
        silent.registerServerCooldown(Duration.ofMinutes(1), silent = true)
        silent.consume()
        assertEquals(0, blockedCalls.size, "case: silent cooldown must not notify")
    }

    @Test
    fun `tryAcquire denies requests during a server cooldown without spending tokens`() {
        val limiter = limiter(5)

        limiter.registerServerCooldown(Duration.ofSeconds(60), silent = true)

        // The limiter must actually gate the request: a Retry-After that only
        // fires a callback and lets the send proceed is the bug.
        assertTrue(limiter.isCoolingDown(), "case: cooldown is active")
        repeat(5) {
            assertFalse(limiter.tryAcquire(), "case: cooldown denial #$it")
        }
        assertEquals(
            5,
            limiter.metricsSnapshot().remaining,
            "case: a denied request must not spend a token",
        )

        // World joins no longer call resetState(); the cooldown must survive one.
        assertTrue(limiter.isCoolingDown(), "case: cooldown survives a lobby hop")
        assertFalse(limiter.tryAcquire(), "case: still denied after a lobby hop")
    }

    @Test
    fun `tryAcquire charges one token per request and per batch identifier`() {
        val single = limiter(2)
        assertTrue(single.tryAcquire(), "case: single request 1")
        assertTrue(single.tryAcquire(), "case: single request 2")
        assertFalse(single.tryAcquire(), "case: budget exhausted")

        val batch = limiter(10)
        assertTrue(batch.tryAcquire(4), "case: batch of 4 within budget")
        assertEquals(6, batch.metricsSnapshot().remaining, "case: batch of 4 costs 4")
        assertTrue(batch.tryAcquire(6), "case: batch of 6 exactly empties the budget")
        assertEquals(0, batch.metricsSnapshot().remaining, "case: exact batch leaves zero")
        assertFalse(batch.tryAcquire(1), "case: one more identifier must be denied")
    }
}
