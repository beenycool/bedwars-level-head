package club.sk1er.mods.levelhead.core

import club.sk1er.mods.levelhead.bedwars.FetchResult
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import org.apache.logging.log4j.LogManager
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertSame
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import java.time.Duration
import java.util.UUID

/**
 * The state machine that replaced `StatsRepository` + `CacheApplier` + `FetchPlanner`:
 * one map, explicit states, a TTL and an LRU cap.
 *
 * Also pins the request-lifecycle rules that write to it: a world join must not
 * clear the store, and a failed proxy batch must stay one request rather than
 * fanning out into per-identifier lookups.
 */
class StatsStoreTest {

    private val logger = LogManager.getLogger("StatsStoreTest")
    private val uuid: UUID = UUID.randomUUID()
    private var now = 1_000_000L

    @BeforeEach
    fun resetBackoff() {
        FetchBackoff.reset()
    }

    private fun store(maxSize: Int = 128, ttlMinutes: Long = 30): StatsStore = StatsStore(
        maxSizeProvider = { maxSize },
        ttlProvider = { Duration.ofMinutes(ttlMinutes) },
        clock = { now }
    )

    private fun stats(star: Int = 123, fetchedAt: Long = now): GameStats.Bedwars =
        GameStats.Bedwars(star = star, fkdr = 1.23, nicked = false, fetchedAt = fetchedAt)

    @Test
    fun `a failure never produces tag text`() {
        val store = store()
        store.putFailure(uuid, GameMode.BEDWARS, nextRetryAt = now + 30_000L)

        assertTrue(store.state(uuid, GameMode.BEDWARS) is StatsState.Failed)
        assertNull(store.get(uuid, GameMode.BEDWARS), "a failure is absence, not a value to format")
        assertNull((store.state(uuid, GameMode.BEDWARS) as StatsState).statsOrNull)
    }

    @Test
    fun `a success replaces a failure`() {
        val store = store()
        store.putFailure(uuid, GameMode.BEDWARS, nextRetryAt = now + 30_000L)
        val success = stats()

        store.putSuccess(uuid, GameMode.BEDWARS, success)

        assertSame(success, store.get(uuid, GameMode.BEDWARS))
        assertTrue(store.state(uuid, GameMode.BEDWARS) is StatsState.Ok)
    }

    @Test
    fun `a failed refresh keeps the last good stats`() {
        val store = store()
        val success = stats()
        store.putSuccess(uuid, GameMode.BEDWARS, success)

        store.putFailure(uuid, GameMode.BEDWARS, nextRetryAt = now + 60_000L)

        assertSame(success, store.get(uuid, GameMode.BEDWARS), "a failed refresh must not drop a stale tag")
        assertTrue(store.state(uuid, GameMode.BEDWARS) is StatsState.Ok)
    }

    @Test
    fun `a failure counts attempts`() {
        val store = store()
        store.putFailure(uuid, GameMode.DUELS, nextRetryAt = now + 30_000L)
        store.putFailure(uuid, GameMode.DUELS, nextRetryAt = now + 60_000L)

        val failed = store.state(uuid, GameMode.DUELS) as StatsState.Failed
        assertEquals(2, failed.attempts)
        assertEquals(now + 60_000L, failed.nextRetryAt)
    }

    @Test
    fun `a nicked result is its own state and still renders`() {
        val store = store()
        val nicked = GameStats.Bedwars(null, null, nicked = true, fetchedAt = now)

        store.putSuccess(uuid, GameMode.BEDWARS, nicked)

        assertTrue(store.state(uuid, GameMode.BEDWARS) is StatsState.Nicked)
        assertSame(nicked, store.get(uuid, GameMode.BEDWARS))
    }

    @Test
    fun `loading is absence until the result arrives`() {
        val store = store()
        store.markLoading(uuid, GameMode.SKYWARS, now)

        assertTrue(store.state(uuid, GameMode.SKYWARS) is StatsState.Loading)
        assertNull(store.get(uuid, GameMode.SKYWARS))
    }

    @Test
    fun `marking loading never hides usable stats`() {
        val store = store()
        val success = stats()
        store.putSuccess(uuid, GameMode.BEDWARS, success)

        store.markLoading(uuid, GameMode.BEDWARS, now)

        assertSame(success, store.get(uuid, GameMode.BEDWARS))
    }

    @Test
    fun `TTL expiry makes the entry stale and triggers refetch`() {
        val store = store(ttlMinutes = 30)
        val fetchedAt = now
        val stale = stats(fetchedAt = fetchedAt)
        store.putSuccess(uuid, GameMode.BEDWARS, stale)

        now = fetchedAt + Duration.ofMinutes(29).toMillis()
        assertFalse(store.needsFetch(uuid, GameMode.BEDWARS))
        assertEquals(StatsLookup.HIT, store.lookup(uuid, GameMode.BEDWARS))

        now = fetchedAt + Duration.ofMinutes(31).toMillis()
        assertTrue(store.needsFetch(uuid, GameMode.BEDWARS))
        assertEquals(StatsLookup.STALE, store.lookup(uuid, GameMode.BEDWARS))
        // Stale data is still rendered while the refresh is in flight.
        assertSame(stale, store.get(uuid, GameMode.BEDWARS))
        assertTrue(
            store.metricsSnapshot().expired >= 1L,
            "a TTL miss must be recorded as an expired refresh"
        )
    }

    @Test
    fun `a cold miss is counted`() {
        val store = store()
        assertEquals(StatsLookup.MISS, store.lookup(uuid, GameMode.DUELS))
        assertEquals(1L, store.metricsSnapshot().cold)
    }

    @Test
    fun `LRU cap evicts the least recently used entry`() {
        val store = store(maxSize = 2)
        val first = UUID.randomUUID()
        val second = UUID.randomUUID()
        val third = UUID.randomUUID()

        store.putSuccess(first, GameMode.BEDWARS, stats(star = 1))
        store.putSuccess(second, GameMode.BEDWARS, stats(star = 2))
        // Touch the first so the second is now the least recently used.
        store.get(first, GameMode.BEDWARS)
        store.putSuccess(third, GameMode.BEDWARS, stats(star = 3))

        assertEquals(2, store.size())
        assertTrue(store.get(first, GameMode.BEDWARS) != null)
        assertNull(store.get(second, GameMode.BEDWARS), "the least recently used entry must be evicted")
        assertTrue(store.get(third, GameMode.BEDWARS) != null)
    }

    @Test
    fun `every successful write gets a new version`() {
        val store = store()
        store.putSuccess(uuid, GameMode.BEDWARS, stats(star = 1))
        val first = store.version(uuid, GameMode.BEDWARS)
        store.putSuccess(uuid, GameMode.BEDWARS, stats(star = 2))
        val second = store.version(uuid, GameMode.BEDWARS)

        assertTrue(second > first)
    }

    @Test
    fun `world join does not clear the store`() {
        val store = store()
        val success = stats()
        store.putSuccess(uuid, GameMode.BEDWARS, success)

        ModeManager.onWorldJoin()

        // This is what Levelhead.playerJoin does on every world hop: cancel the
        // previous world's requests without wiping the star store.
        val coordinator = RequestCoordinator(
            worldScopeProvider = { CoroutineScope(Dispatchers.Default) },
            store = store,
            rateLimiter = RateLimiter(100, Duration.ofMinutes(1), {}, {}),
            isOnHypixel = { true },
            logger = logger,
        )
        coordinator.reset()

        assertSame(success, store.get(uuid, GameMode.BEDWARS))
    }

    @Test
    fun `a failed proxy batch issues exactly one request and no per-identifier fan-out`() {
        var batchCalls = 0
        var successes = 0
        var failures = 0
        val uuids = List(4) { UUID.randomUUID() }
        val executor = FetchExecutor(
            worldScopeProvider = { CoroutineScope(Dispatchers.Default) },
            rateLimiter = RateLimiter(100, Duration.ofMinutes(1), {}, {}),
            logger = logger,
            batchFetcher = { ids ->
                batchCalls++
                ids.associateWith { FetchResult.TemporaryError("HTTP_503") }
            },
        )

        val planned = uuids.map { id -> FetchWork(id, GameMode.BEDWARS, cached = null) }

        val remaining = runBlocking {
            executor.executeProxyBatch(planned) { _, stats ->
                if (stats == null) failures++ else successes++
            }
        }

        assertEquals(1, batchCalls, "one batch must stay one request")
        assertTrue(remaining.isEmpty(), "proxy candidates must not fall through to per-identifier fetches")
        assertEquals(0, successes, "a failed batch must not report a value that could become a tag")
        assertEquals(4, failures, "each failed identifier is reported as absent")

        // The backend is now in backoff; another round must not touch it.
        runBlocking {
            executor.executeProxyBatch(planned) { _, stats ->
                if (stats == null) failures++ else successes++
            }
        }
        assertEquals(1, batchCalls, "backoff must suppress the retry storm")
        assertEquals(0, successes)
    }
}
