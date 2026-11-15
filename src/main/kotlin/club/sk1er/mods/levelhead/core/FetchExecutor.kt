package club.sk1er.mods.levelhead.core

import club.sk1er.mods.levelhead.bedwars.FetchResult
import club.sk1er.mods.levelhead.bedwars.ProxyClient
import club.sk1er.mods.levelhead.core.DebugLogging.maskForLogs
import kotlinx.coroutines.*
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import org.apache.logging.log4j.Logger
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import kotlin.random.Random

/**
 * One player/mode pair that the coordinator decided must go to the network.
 * [cached] carries the stale value for a revalidation, so a failed refresh can
 * keep serving the last good stats.
 */
data class FetchWork(
    val uuid: UUID,
    val gameMode: GameMode,
    val cached: GameStats?
) {
    val key: StatsKey get() = StatsKey(uuid, gameMode)
}

class FetchExecutor(
    private val worldScopeProvider: () -> CoroutineScope,
    private val rateLimiter: RateLimiter,
    private val logger: Logger,
    private val batchFetcher: suspend (List<UUID>) -> Map<UUID, FetchResult> = { ProxyClient.fetchBatch(it) },
    private val backoff: FetchBackoff = FetchBackoff
) {
    private val inFlightStatsRequests: ConcurrentHashMap<StatsKey, Deferred<GameStats?>> = ConcurrentHashMap()

    /**
     * Proxy work that has been claimed by a running batch. A second request for the
     * same key joins this deferred instead of receiving a null placeholder, so a
     * concurrent caller sees the real in-flight result.
     */
    private val inFlightProxyRequests: ConcurrentHashMap<StatsKey, CompletableDeferred<GameStats?>> = ConcurrentHashMap()
    private val starFetchSemaphore: Semaphore = Semaphore(6)
    @Volatile
    private var lastFetchAttemptAt: Long = 0L
    @Volatile
    private var lastFetchSuccessAt: Long = 0L

    val lastAttemptAgeMillis: Long?
        get() = lastFetchAttemptAt.takeIf { it > 0 }?.let { System.currentTimeMillis() - it }

    val lastSuccessAgeMillis: Long?
        get() = lastFetchSuccessAt.takeIf { it > 0 }?.let { System.currentTimeMillis() - it }

    /**
     * Execute proxy batch fetching for the given work.
     *
     * Every entry that was claimed by a proxy batch is removed from the returned
     * list regardless of the outcome. A failed batch must not fan out into one
     * proxy call per identifier (and then into keyless Hypixel calls); the retry
     * loop re-batches these entries once the exponential backoff expires.
     *
     * [onResult] receives the real value on success and `null` on failure. The
     * coordinator writes that into [StatsStore]; nothing here touches displays.
     */
    suspend fun executeProxyBatch(
        planned: List<FetchWork>,
        onResult: (StatsKey, GameStats?) -> Unit
    ): List<FetchWork> {
        if (planned.isEmpty()) return emptyList()

        val claims = LinkedHashMap<StatsKey, CompletableDeferred<GameStats?>>()
        for (entry in planned) {
            if (inFlightStatsRequests.containsKey(entry.key)) continue
            if (inFlightProxyRequests.containsKey(entry.key)) continue
            val deferred = CompletableDeferred<GameStats?>()
            if (inFlightProxyRequests.putIfAbsent(entry.key, deferred) == null) {
                claims[entry.key] = deferred
            }
        }

        // Entries we did not claim keep whatever path they already have (in-flight
        // dedupe or a call that awaits an existing proxy result).
        val remaining = planned.filterNot { it.key in claims }
        if (claims.isEmpty()) return remaining

        val candidates = planned.filter { it.key in claims }
        val now = System.currentTimeMillis()
        if (!backoff.proxyReady(now)) {
            // The backend is in a failure backoff window: do not send anything.
            candidates.forEach {
                backoff.recordFailure(it.uuid, now)
                onResult(it.key, null)
                claims[it.key]?.complete(null)
            }
            claims.forEach { (key, deferred) -> inFlightProxyRequests.remove(key, deferred) }
            return remaining
        }

        try {
            val entriesByUuid = candidates.groupBy { it.uuid }

            for (chunk in entriesByUuid.keys.chunked(20)) {
                // One token per identifier, matching the public batch budget.
                if (!rateLimiter.tryAcquire(chunk.size)) {
                    // No token: this chunk is not sent. Back off so the retry loop
                    // does not spin, and let the deferreds complete.
                    chunk.forEach { uuid ->
                        entriesByUuid[uuid].orEmpty().forEach { entry ->
                            backoff.recordFailure(uuid)
                            onResult(entry.key, null)
                            claims[entry.key]?.complete(null)
                        }
                    }
                    continue
                }

                lastFetchAttemptAt = System.currentTimeMillis()
                val results = batchFetcher(chunk)

                chunk.forEach { uuid ->
                    val result = results[uuid]
                    val entries = entriesByUuid[uuid].orEmpty()
                    if (entries.isEmpty()) return@forEach

                    when (result) {
                        is FetchResult.Success -> {
                            lastFetchSuccessAt = System.currentTimeMillis()
                            entries.forEach { entry ->
                                val cachedEntry = StatsFetcher.buildGameStats(
                                    result.payload, entry.gameMode, result.etag
                                )
                                onResult(entry.key, cachedEntry)
                                claims[entry.key]?.complete(cachedEntry)
                            }
                            backoff.recordSuccess(uuid)
                        }
                        else -> {
                            entries.forEach { entry ->
                                backoff.recordFailure(uuid)
                                onResult(entry.key, null)
                                claims[entry.key]?.complete(null)
                            }
                        }
                    }
                }

                if (chunk.any { results[it] is FetchResult.Success }) {
                    backoff.recordProxySuccess()
                } else {
                    // The whole chunk failed: stop before sending every remaining
                    // chunk into a backend that is already refusing us. The retry
                    // loop re-batches once the backoff expires.
                    backoff.recordProxyFailure()
                    break
                }
            }
        } finally {
            claims.forEach { (key, deferred) ->
                if (!deferred.isCompleted) deferred.complete(null)
                inFlightProxyRequests.remove(key, deferred)
            }
        }

        return remaining
    }

    /**
     * Execute a direct (non-proxy) fetch for one work item.
     * Uses in-flight deduplication and semaphore-based concurrency limiting.
     */
    internal fun ensureStatsFetch(
        work: FetchWork,
        onResult: (StatsKey, GameStats?) -> Unit
    ): Deferred<GameStats?> {
        val cacheKey = work.key
        val existing = inFlightStatsRequests[cacheKey]
        if (existing != null) {
            DebugLogging.logRequestDebug {
                "[LevelheadDebug][request] in-flight dedupe reuse: uuid=${cacheKey.uuid.maskForLogs()} mode=${cacheKey.gameMode.name}"
            }
            return existing
        }

        // A proxy batch already owns this key. Share its real result instead of
        // fabricating a null answer for a COLD entry.
        inFlightProxyRequests[cacheKey]?.let { proxyDeferred ->
            DebugLogging.logRequestDebug {
                "[LevelheadDebug][request] joining proxy batch: uuid=${cacheKey.uuid.maskForLogs()} mode=${cacheKey.gameMode.name}"
            }
            return proxyDeferred
        }

        val cached = work.cached
        val isRevalidation = cached != null
        val deferred = worldScopeProvider().async {
            starFetchSemaphore.withPermit {
                if (!backoff.canAttempt(cacheKey.uuid)) {
                    return@withPermit cached
                }
                if (isRevalidation) {
                    delay(Random.nextLong(50L, 201L))
                }
                try {
                    if (!rateLimiter.tryAcquire()) {
                        backoff.recordFailure(cacheKey.uuid)
                        onResult(cacheKey, null)
                        return@withPermit cached
                    }
                    lastFetchAttemptAt = System.currentTimeMillis()
                    val gameMode = cacheKey.gameMode
                    when (val result = StatsFetcher.fetchPlayer(cacheKey.uuid, gameMode)) {
                        is FetchResult.Success -> {
                            lastFetchSuccessAt = System.currentTimeMillis()
                            val entry = StatsFetcher.buildGameStats(result.payload, gameMode)
                            if (entry != null) {
                                backoff.recordSuccess(cacheKey.uuid)
                                onResult(cacheKey, entry)
                            } else {
                                backoff.recordFailure(cacheKey.uuid)
                                onResult(cacheKey, null)
                            }
                            entry
                        }
                        else -> {
                            backoff.recordFailure(cacheKey.uuid)
                            onResult(cacheKey, null)
                            null
                        }
                    }
                } catch (cancellation: CancellationException) {
                    // Never swallow cancellation: a cancelled duplicate (dedupe or
                    // world reset) must not report a null completion, which would
                    // drop a concurrent successful fetch.
                    throw cancellation
                } catch (throwable: Throwable) {
                    // A user-visible failure, not a debug footnote: this is why a
                    // fetch that failed used to be indistinguishable from "no data".
                    logger.warn(
                        "Failed to fetch stats for {} ({})",
                        cacheKey.uuid,
                        cacheKey.gameMode,
                        throwable
                    )
                    backoff.recordFailure(cacheKey.uuid)
                    onResult(cacheKey, null)
                    null
                }
            }
        }

        val previous = inFlightStatsRequests.putIfAbsent(cacheKey, deferred)
        if (previous != null) {
            deferred.cancel()
            return previous
        }

        deferred.invokeOnCompletion { inFlightStatsRequests.remove(cacheKey, deferred) }
        return deferred
    }

    fun reset() {
        inFlightStatsRequests.values.forEach { it.cancel() }
        inFlightStatsRequests.clear()
        inFlightProxyRequests.values.forEach { if (!it.isCompleted) it.complete(null) }
        inFlightProxyRequests.clear()
        resetFetchTimestamps()
    }

    fun resetFetchTimestamps() {
        lastFetchAttemptAt = 0L
        lastFetchSuccessAt = 0L
    }
}
