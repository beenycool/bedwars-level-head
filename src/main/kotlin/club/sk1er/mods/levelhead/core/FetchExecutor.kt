package club.sk1er.mods.levelhead.core

import club.sk1er.mods.levelhead.bedwars.BatchCacheStatus
import club.sk1er.mods.levelhead.bedwars.BatchFetchResponse
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
    private val store: StatsStore,
    private val logger: Logger,
    private val batchFetcher: suspend (List<UUID>, Boolean) -> BatchFetchResponse = { uuids, cacheOnly ->
        ProxyClient.fetchBatch(uuids, cacheOnly)
    },
    private val backoff: FetchBackoff = FetchBackoff
) {
    private val inFlightStatsRequests: ConcurrentHashMap<StatsKey, Deferred<GameStats?>> = ConcurrentHashMap()

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

    suspend fun executeProxyBatch(
        planned: List<FetchWork>,
        onResult: (StatsKey, GameStats?) -> Unit,
        cacheOnly: Boolean = false
    ): List<FetchWork> {
        if (planned.isEmpty()) return emptyList()
        DebugLogging.logRequestDebug {
            "[LevelheadDebug][batch] ${DebugSession.prefix()} planned=${planned.size} inFlightStats=${inFlightStatsRequests.size} inFlightProxy=${inFlightProxyRequests.size} proxyReady=${backoff.proxyReady(System.currentTimeMillis())}"
        }

        val claims = LinkedHashMap<StatsKey, CompletableDeferred<GameStats?>>()
        for (entry in planned) {
            if (inFlightStatsRequests.containsKey(entry.key)) continue
            if (inFlightProxyRequests.containsKey(entry.key)) continue
            val deferred = CompletableDeferred<GameStats?>()
            if (inFlightProxyRequests.putIfAbsent(entry.key, deferred) == null) {
                claims[entry.key] = deferred
            }
        }

        val remaining = planned.filterNot { it.key in claims }
        DebugLogging.logRequestDebug {
            "[LevelheadDebug][batch] ${DebugSession.prefix()} claimed=${claims.size} remaining=${remaining.size} sample=${claims.keys.take(8).map { it.uuid.maskForLogs() + "/" + it.gameMode.name }}"
        }
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
                DebugLogging.logRequestDebug {
                    "[LevelheadDebug][batch] ${DebugSession.prefix()} chunk size=${chunk.size} rate=${rateLimiter.metricsSnapshot()}"
                }
                // One token per identifier, matching the public batch budget. A
                // chunk larger than the window must not be dropped wholesale: send
                // what the window can pay for and fail the remainder normally.
                val available = rateLimiter.metricsSnapshot().remaining
                if (available <= 0) {
                    DebugSession.inc("batch_rate_denied", chunk.size)
                    DebugLogging.logRequestDebug {
                        "[LevelheadDebug][batch] ${DebugSession.prefix()} rateDenied chunk=${chunk.size} rate=${rateLimiter.metricsSnapshot()}"
                    }
                    failEntries(chunk, entriesByUuid, claims, onResult)
                    continue
                }

                val sent = if (available >= chunk.size) chunk else chunk.take(available)
                val unsent = chunk.drop(sent.size)
                if (unsent.isNotEmpty()) {
                    DebugSession.inc("batch_rate_partial", unsent.size)
                    DebugLogging.logRequestDebug {
                        "[LevelheadDebug][batch] ${DebugSession.prefix()} ratePartial chunk=${chunk.size} sent=${sent.size} deferred=${unsent.size} rate=${rateLimiter.metricsSnapshot()}"
                    }
                    failEntries(unsent, entriesByUuid, claims, onResult)
                }

                if (!rateLimiter.tryAcquire(sent.size)) {
                    // Another request can consume the window between the snapshot
                    // and the acquire; never send work that was not paid for.
                    DebugSession.inc("batch_rate_denied", sent.size)
                    DebugLogging.logRequestDebug {
                        "[LevelheadDebug][batch] ${DebugSession.prefix()} rateDenied chunk=${sent.size} rate=${rateLimiter.metricsSnapshot()}"
                    }
                    failEntries(sent, entriesByUuid, claims, onResult)
                    continue
                }

                lastFetchAttemptAt = System.currentTimeMillis()
                val fetchStartedAt = System.currentTimeMillis()
                val response = batchFetcher(sent, cacheOnly)
                val results = response.results
                val successCount = results.values.count { it is FetchResult.Success }
                DebugSession.inc("batch_chunks")
                DebugSession.inc("batch_entries", sent.size)
                DebugSession.inc("batch_results", results.size)
                DebugSession.inc("batch_success", successCount)
                DebugLogging.logRequestDebug {
                    "[LevelheadDebug][batch] ${DebugSession.prefix()} chunk=${sent.size} results=${results.size} success=$successCount cache=${response.cacheStatus.name} cacheOnly=$cacheOnly transportFailure=${response.transportFailure} elapsedMs=${System.currentTimeMillis() - fetchStartedAt}"
                }

                sent.forEach { uuid ->
                    val result = results[uuid]
                    val entries = entriesByUuid[uuid].orEmpty()
                    if (entries.isEmpty()) return@forEach

                    when (result) {
                        is FetchResult.Success -> {
                            var builtAny = false
                            val missing = ArrayList<FetchWork>()
                            entries.forEach { entry ->
                                val stats = StatsFetcher.buildGameStats(
                                    result.payload, entry.gameMode
                                )
                                if (stats != null) {
                                    builtAny = true
                                    onResult(entry.key, stats)
                                    claims[entry.key]?.complete(stats)
                                } else {
                                    // The HTTP call succeeded but this payload has no
                                    // stats for the requested mode. Treat it as a
                                    // failure for this player, otherwise Success clears
                                    // the backoff and the 2 s retry loop never stops.
                                    missing.add(entry)
                                }
                            }
                            if (missing.isNotEmpty()) {
                                backoff.recordFailure(uuid)
                                missing.forEach { entry ->
                                    onResult(entry.key, null)
                                    claims[entry.key]?.complete(null)
                                }
                            } else {
                                backoff.recordSuccess(uuid)
                            }
                            if (builtAny) {
                                lastFetchSuccessAt = System.currentTimeMillis()
                            }
                        }
                        FetchResult.Absent -> {
                            // Cache-only miss: benign, so it must not feed the
                            // failure counter or the global proxy backoff.
                            backoff.recordCacheOnlyMiss(uuid)
                            entries.forEach { entry ->
                                onResult(entry.key, null)
                                claims[entry.key]?.complete(null)
                            }
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

                if (response.transportFailure) {
                    // The backend itself is unhealthy: stop before sending every
                    // remaining chunk into it. Per-player data problems (including
                    // a chunk with zero successes) no longer land here.
                    backoff.recordProxyFailure()
                    claims.forEach { (key, deferred) ->
                        if (!deferred.isCompleted) {
                            backoff.recordFailure(key.uuid)
                            onResult(key, null)
                            deferred.complete(null)
                        }
                    }
                    break
                }

                // Served from the backend cache: no upstream quota was spent, so
                // return the identifiers to this window. Feature-detected, because
                // older backends only expose X-Cache.
                val refundable = response.cacheHits
                    ?: (if (response.cacheStatus == BatchCacheStatus.HIT) sent.size else 0)
                val refund = refundable.coerceAtMost(sent.size)
                if (refund > 0) {
                    rateLimiter.refund(refund)
                    DebugSession.inc("batch_tokens_refunded", refund)
                }
                backoff.recordProxySuccess()
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
     * Fail the given identifiers through the normal failure path: record the
     * backoff, notify the store, and complete the shared deferred.
     */
    private fun failEntries(
        uuids: List<UUID>,
        entriesByUuid: Map<UUID, List<FetchWork>>,
        claims: Map<StatsKey, CompletableDeferred<GameStats?>>,
        onResult: (StatsKey, GameStats?) -> Unit
    ) {
        uuids.forEach { uuid ->
            entriesByUuid[uuid].orEmpty().forEach { entry ->
                backoff.recordFailure(uuid)
                onResult(entry.key, null)
                claims[entry.key]?.complete(null)
            }
        }
    }

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

        // Another owner may have completed this key during the batch round-trip.
        val fresh = store.get(cacheKey.uuid, cacheKey.gameMode)
        if (fresh != null && !store.needsFetch(cacheKey.uuid, cacheKey.gameMode)) {
            DebugLogging.logRequestDebug {
                "[LevelheadDebug][request] fresh-skip: uuid=${cacheKey.uuid.maskForLogs()} mode=${cacheKey.gameMode.name}"
            }
            return CompletableDeferred(fresh)
        }

        val cached = work.cached
        val isRevalidation = cached != null
        DebugLogging.logRequestDebug {
            "[LevelheadDebug][direct] ${DebugSession.prefix()} start uuid=${cacheKey.uuid.maskForLogs()} mode=${cacheKey.gameMode.name} revalidation=$isRevalidation"
        }
        val deferred = worldScopeProvider().async {
            starFetchSemaphore.withPermit {
                if (!backoff.canAttempt(cacheKey.uuid)) {
                    DebugLogging.logRequestDebug {
                        "[LevelheadDebug][direct] ${DebugSession.prefix()} backoff-skip uuid=${cacheKey.uuid.maskForLogs()} mode=${cacheKey.gameMode.name}"
                    }
                    return@withPermit cached
                }
                if (isRevalidation) {
                    delay(Random.nextLong(50L, 201L))
                }
                try {
                    if (!rateLimiter.tryAcquire()) {
                        DebugSession.inc("direct_rate_denied")
                        DebugLogging.logRequestDebug {
                            "[LevelheadDebug][direct] ${DebugSession.prefix()} rateDenied uuid=${cacheKey.uuid.maskForLogs()} mode=${cacheKey.gameMode.name} rate=${rateLimiter.metricsSnapshot()}"
                        }
                        backoff.recordFailure(cacheKey.uuid)
                        onResult(cacheKey, null)
                        return@withPermit cached
                    }
                    lastFetchAttemptAt = System.currentTimeMillis()
                    val gameMode = cacheKey.gameMode
                    val fetchStartedAt = System.currentTimeMillis()
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
                            DebugSession.inc("direct_success")
                            DebugLogging.logRequestDebug {
                                "[LevelheadDebug][direct] ${DebugSession.prefix()} success=true built=${entry != null} uuid=${cacheKey.uuid.maskForLogs()} mode=${gameMode.name} elapsedMs=${System.currentTimeMillis() - fetchStartedAt}"
                            }
                            entry
                        }
                        else -> {
                            backoff.recordFailure(cacheKey.uuid)
                            onResult(cacheKey, null)
                            DebugSession.inc("direct_failure")
                            DebugLogging.logRequestDebug {
                                "[LevelheadDebug][direct] ${DebugSession.prefix()} success=false uuid=${cacheKey.uuid.maskForLogs()} mode=${gameMode.name} elapsedMs=${System.currentTimeMillis() - fetchStartedAt} result=$result"
                            }
                            null
                        }
                    }
                } catch (cancellation: CancellationException) {
                    // Never swallow cancellation: a cancelled duplicate (dedupe or
                    // world reset) must not report a null completion, which would
                    // drop a concurrent successful fetch.
                    throw cancellation
                } catch (throwable: Throwable) {
                    DebugSession.inc("direct_exception")
                    DebugLogging.logRequestDebug {
                        "[LevelheadDebug][direct] ${DebugSession.prefix()} exception uuid=${cacheKey.uuid.maskForLogs()} mode=${cacheKey.gameMode.name} error=${throwable.javaClass.simpleName}: ${throwable.message}"
                    }
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
        DebugLogging.logRequestDebug {
            "[LevelheadDebug][batch] ${DebugSession.prefix()} reset inFlightStats=${inFlightStatsRequests.size} inFlightProxy=${inFlightProxyRequests.size}"
        }
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
