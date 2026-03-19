package club.sk1er.mods.levelhead.core

import club.sk1er.mods.levelhead.bedwars.FetchResult
import club.sk1er.mods.levelhead.bedwars.ProxyClient
import club.sk1er.mods.levelhead.config.LevelheadConfig
import club.sk1er.mods.levelhead.core.DebugLogging.maskForLogs
import kotlinx.coroutines.*
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import org.apache.logging.log4j.Logger
import java.util.concurrent.ConcurrentHashMap
import kotlin.random.Random

class FetchExecutor(
    private val worldScopeProvider: () -> CoroutineScope,
    private val rateLimiter: RateLimiter,
    private val logger: Logger
) {
    private val inFlightStatsRequests: ConcurrentHashMap<StatsCacheKey, Deferred<GameStats?>> = ConcurrentHashMap()
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
     * Execute proxy batch fetching for the given planned fetches.
     * Returns the list of entries that were NOT handled by proxy (remaining for direct fetch).
     */
    suspend fun executeProxyBatch(
        planned: List<PlannedFetch>,
        onCompletion: (StatsCacheKey, GameStats?) -> Unit
    ): List<PlannedFetch> {
        if (!LevelheadConfig.proxyEnabled) return planned.toList()

        val remaining = planned.toMutableList()
        val proxyCandidates = remaining.filter { !inFlightStatsRequests.containsKey(it.cacheKey) }
        if (proxyCandidates.isEmpty()) return remaining

        val batchLocks = proxyCandidates.associate { entry ->
            val deferred = CompletableDeferred<GameStats?>()
            val existing = inFlightStatsRequests.putIfAbsent(entry.cacheKey, deferred)
            entry.cacheKey to (if (existing == null) deferred else null)
        }.filterValues { it != null }.mapValues { it.value!! }

        val lockedEligible = proxyCandidates.filter { batchLocks.containsKey(it.cacheKey) }
        val entriesByUuid = lockedEligible.groupBy { it.uuid }

        lockedEligible
            .map { it.uuid }
            .distinct()
            .chunked(10)
            .forEach { chunk ->
                lastFetchAttemptAt = System.currentTimeMillis()
                rateLimiter.consume()

                val results = ProxyClient.fetchBatch(chunk)

                chunk.forEach uuidLoop@{ uuid ->
                    val result = results[uuid]
                    val entries = entriesByUuid[uuid].orEmpty()

                    if (entries.isEmpty() || result == null) {
                        entries.forEach { entry ->
                            batchLocks[entry.cacheKey]?.complete(null)
                            inFlightStatsRequests.remove(entry.cacheKey)
                        }
                        return@uuidLoop
                    }

                    when (result) {
                        is FetchResult.Success -> {
                            lastFetchSuccessAt = System.currentTimeMillis()
                            entries.forEach { entry ->
                                val cachedEntry = StatsFetcher.buildGameStats(
                                    result.payload, entry.gameMode, result.etag
                                )
                                if (cachedEntry != null) {
                                    onCompletion(entry.cacheKey, cachedEntry)
                                    remaining.remove(entry)
                                    batchLocks[entry.cacheKey]?.complete(cachedEntry)
                                    inFlightStatsRequests.remove(entry.cacheKey)
                                } else {
                                    batchLocks[entry.cacheKey]?.complete(null)
                                    inFlightStatsRequests.remove(entry.cacheKey)
                                }
                            }
                        }
                        else -> {
                            val proxyErrorReason = when (result) {
                                is FetchResult.TemporaryError -> result.reason
                                is FetchResult.PermanentError -> result.reason
                                else -> null
                            }
                            entries.forEach { entry ->
                                val shouldSkipFallback = LevelheadConfig.proxyEnabled &&
                                    entry.cached != null &&
                                    proxyErrorReason != null &&
                                    proxyErrorReason != "PROXY_AUTH" &&
                                    (proxyErrorReason.startsWith("PROXY_") || proxyErrorReason.startsWith("HTTP_"))

                                if (shouldSkipFallback) {
                                    remaining.remove(entry)
                                    DebugLogging.logRequestDebug {
                                        "[LevelheadDebug][request] fallback skipped: uuid=${entry.uuid.maskForLogs()} mode=${entry.gameMode.name} reason=$proxyErrorReason"
                                    }
                                }
                                batchLocks[entry.cacheKey]?.complete(null)
                                inFlightStatsRequests.remove(entry.cacheKey)
                            }
                        }
                    }
                }
            }

        return remaining
    }

    /**
     * Execute direct (non-proxy) fetches for the given planned fetches.
     * Uses in-flight deduplication and semaphore-based concurrency limiting.
     */
    fun executeDirect(
        planned: List<PlannedFetch>,
        onCompletion: (StatsCacheKey, GameStats?) -> Unit
    ): List<Deferred<GameStats?>> {
        return planned.map { entry ->
            ensureStatsFetch(entry.cacheKey, entry.cached, onCompletion)
        }
    }

    internal fun ensureStatsFetch(
        cacheKey: StatsCacheKey,
        cached: GameStats?,
        onCompletion: (StatsCacheKey, GameStats?) -> Unit
    ): Deferred<GameStats?> {
        val existing = inFlightStatsRequests[cacheKey]
        if (existing != null) {
            DebugLogging.logRequestDebug {
                "[LevelheadDebug][request] in-flight dedupe reuse: uuid=${cacheKey.uuid.maskForLogs()} mode=${cacheKey.gameMode.name}"
            }
            return existing
        }

        val isRevalidation = cached != null
        val deferred = worldScopeProvider().async {
            starFetchSemaphore.withPermit {
                if (isRevalidation) {
                    delay(Random.nextLong(50L, 201L))
                }
                try {
                    lastFetchAttemptAt = System.currentTimeMillis()
                    rateLimiter.consume()
                    val gameMode = cacheKey.gameMode
                    when (val result = StatsFetcher.fetchPlayer(cacheKey.uuid, gameMode, cached?.fetchedAt, cached?.etag)) {
                        is FetchResult.Success -> {
                            lastFetchSuccessAt = System.currentTimeMillis()
                            val entry = StatsFetcher.buildGameStats(result.payload, gameMode, result.etag)
                            onCompletion(cacheKey, entry)
                            entry
                        }
                        FetchResult.NotModified -> {
                            lastFetchSuccessAt = System.currentTimeMillis()
                            val refreshed = when (cached) {
                                is GameStats.Bedwars -> cached.copy(fetchedAt = System.currentTimeMillis())
                                is GameStats.Duels -> cached.copy(fetchedAt = System.currentTimeMillis())
                                is GameStats.SkyWars -> cached.copy(fetchedAt = System.currentTimeMillis())
                                null -> null
                            }
                            refreshed?.let { onCompletion(cacheKey, it) }
                            refreshed
                        }
                        is FetchResult.TemporaryError -> {
                            onCompletion(cacheKey, cached)
                            null
                        }
                        is FetchResult.PermanentError -> {
                            onCompletion(cacheKey, cached)
                            null
                        }
                    }
                } catch (throwable: Throwable) {
                    logger.debug(
                        "Failed to fetch stats for {} ({})",
                        cacheKey.uuid,
                        cacheKey.gameMode,
                        throwable
                    )
                    onCompletion(cacheKey, null)
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
        resetFetchTimestamps()
    }

    fun resetFetchTimestamps() {
        lastFetchAttemptAt = 0L
        lastFetchSuccessAt = 0L
    }
}
