package club.sk1er.mods.levelhead.core

import club.sk1er.mods.levelhead.Levelhead
import club.sk1er.mods.levelhead.bedwars.FetchResult
import club.sk1er.mods.levelhead.bedwars.ProxyClient
import club.sk1er.mods.levelhead.config.LevelheadConfig
import club.sk1er.mods.levelhead.core.DebugLogging.maskForLogs
import club.sk1er.mods.levelhead.core.DebugLogging.maskIfUuid
import club.sk1er.mods.levelhead.display.LevelheadDisplay
import kotlinx.coroutines.*
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import org.apache.logging.log4j.Logger
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import kotlin.random.Random

class RequestCoordinator(
    private val worldScopeProvider: () -> CoroutineScope,
    private val repository: StatsRepository,
    private val rateLimiter: RateLimiter,
    private val isOnHypixel: () -> Boolean,
    private val onTagUpdate: (display: LevelheadDisplay, uuid: UUID, stats: GameStats?, gameMode: GameMode) -> Unit,
    private val logger: Logger
) {
    private val inFlightStatsRequests: ConcurrentHashMap<StatsCacheKey, Deferred<GameStats?>> = ConcurrentHashMap()
    private val pendingDisplayRefreshes: ConcurrentHashMap<StatsCacheKey, MutableSet<LevelheadDisplay>> = ConcurrentHashMap()
    private val starFetchSemaphore: Semaphore = Semaphore(6)
    @Volatile
    private var lastFetchAttemptAt: Long = 0L
    @Volatile
    private var lastFetchSuccessAt: Long = 0L

    val lastAttemptAgeMillis: Long?
        get() = lastFetchAttemptAt.takeIf { it > 0 }?.let { System.currentTimeMillis() - it }

    val lastSuccessAgeMillis: Long?
        get() = lastFetchSuccessAt.takeIf { it > 0 }?.let { System.currentTimeMillis() - it }

    fun fetchBatch(requests: List<Levelhead.LevelheadRequest>): Job {
        return worldScopeProvider().launch {
            if (!isOnHypixel()) return@launch
            if (requests.isEmpty()) return@launch

            val now = System.currentTimeMillis()
            val pending = mutableListOf<PendingStatsRequest>()

            requests
                .groupBy { it.uuid }
                .forEach { (trimmedUuid, groupedRequests) ->
                    val uuid = trimmedUuid.dashUUID ?: return@forEach
                    groupedRequests
                        .groupBy { resolveGameMode(it.type) }
                        .forEach { (gameMode, modeRequests) ->
                            val debug = DebugLogging.isRequestDebugEnabled()
                            val displays = modeRequests.map { it.display }.toSet()
                            val cacheKey = StatsCacheKey(uuid, gameMode)
                            val cached = repository.peek(uuid, gameMode)
                            val reasons = if (debug) modeRequests.map { it.reason }.toSet() else null
                            val maskedUuid = if (debug) uuid.maskForLogs() else null
                            val trimmedMasked = if (debug) trimmedUuid.maskIfUuid() else null

                            when {
                                cached == null -> {
                                    repository.recordMiss(CacheMissReason.COLD)
                                    DebugLogging.logRequestDebug {
                                        "[LevelheadDebug][cache] COLD miss: uuid=$maskedUuid trimmed=$trimmedMasked mode=${gameMode.name} reasons=$reasons"
                                    }
                                    pending += PendingStatsRequest(
                                        trimmedUuid,
                                        uuid,
                                        gameMode,
                                        modeRequests,
                                        displays,
                                        cached,
                                        false
                                    )
                                    DebugLogging.logRequestDebug {
                                        "[LevelheadDebug][request] fetch initiated: uuid=$maskedUuid trimmed=$trimmedMasked mode=${gameMode.name} reason=COLD_MISS"
                                    }
                                }
                                cached.isExpired(LevelheadConfig.starCacheTtl, now) -> {
                                    repository.recordMiss(CacheMissReason.EXPIRED)
                                    registerDisplaysForRefresh(cacheKey, displays)
                                    applyStatsToRequests(uuid, modeRequests, cached)
                                    DebugLogging.logRequestDebug {
                                        "[LevelheadDebug][cache] EXPIRED refresh: uuid=$maskedUuid trimmed=$trimmedMasked mode=${gameMode.name} reasons=$reasons"
                                    }
                                    pending += PendingStatsRequest(
                                        trimmedUuid,
                                        uuid,
                                        gameMode,
                                        modeRequests,
                                        displays,
                                        cached,
                                        true
                                    )
                                    DebugLogging.logRequestDebug {
                                        "[LevelheadDebug][request] fetch initiated: uuid=$maskedUuid trimmed=$trimmedMasked mode=${gameMode.name} reason=EXPIRED_REFRESH"
                                    }
                                }
                                else -> {
                                    applyStatsToRequests(uuid, modeRequests, cached)
                                    DebugLogging.logRequestDebug {
                                        "[LevelheadDebug][cache] HIT: uuid=$maskedUuid trimmed=$trimmedMasked mode=${gameMode.name} reasons=$reasons"
                                    }
                                }
                            }
                        }
                }

            if (pending.isEmpty()) return@launch
            if (!ModeManager.shouldRequestData()) return@launch

            val remaining = pending.toMutableList()

            if (LevelheadConfig.proxyEnabled) {
                val proxyCandidates = remaining
                    .filter { inFlightStatsRequests.containsKey(it.cacheKey).not() }
                if (proxyCandidates.isNotEmpty()) {
                    val batchLocks = proxyCandidates.associate { entry ->
                        val deferred = CompletableDeferred<GameStats?>()
                        val existing = inFlightStatsRequests.putIfAbsent(entry.cacheKey, deferred)

                        if (entry.registerForRefresh && entry.displays.isNotEmpty()) {
                            registerDisplaysForRefresh(entry.cacheKey, entry.displays)
                        }

                        entry.cacheKey to (if (existing == null) deferred else null)
                    }.filterValues { it != null }.mapValues { it.value!! }

                    val lockedEligible = proxyCandidates.filter { batchLocks.containsKey(it.cacheKey) }
                    val entriesByUuid = lockedEligible.groupBy { it.uuid }

                    lockedEligible
                        .map { it.uuid }
                        .distinct()
                        .chunked(20)
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
                                                result.payload,
                                                entry.gameMode,
                                                result.etag
                                            )

                                            if (cachedEntry != null) {
                                                handleStatsUpdate(entry.cacheKey, cachedEntry)
                                                applyStatsToRequests(uuid, entry.requests, cachedEntry)
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
                                            if (entry.registerForRefresh && entry.displays.isNotEmpty()) {
                                                registerDisplaysForRefresh(entry.cacheKey, entry.displays)
                                            }

                                            val shouldSkipFallback = LevelheadConfig.proxyEnabled &&
                                                    entry.cached != null &&
                                                    proxyErrorReason != null &&
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
                }
            }

            remaining.forEach { entry ->
                val fetched = ensureStatsFetch(
                    entry.cacheKey,
                    entry.cached,
                    entry.displays,
                    entry.registerForRefresh
                ).await()
                applyStatsToRequests(entry.uuid, entry.requests, fetched)
            }
        }
    }

    internal fun ensureStatsFetch(
        cacheKey: StatsCacheKey,
        cached: GameStats?,
        displays: Collection<LevelheadDisplay>,
        registerForRefresh: Boolean
    ): Deferred<GameStats?> {
        if (registerForRefresh && displays.isNotEmpty()) {
            registerDisplaysForRefresh(cacheKey, displays)
        }

        val existing = inFlightStatsRequests[cacheKey]
        if (existing != null) {
            if (registerForRefresh && displays.isNotEmpty()) {
                registerDisplaysForRefresh(cacheKey, displays)
            }
            DebugLogging.logRequestDebug {
                "[LevelheadDebug][request] in-flight dedupe reuse: uuid=${cacheKey.uuid.maskForLogs()} mode=${cacheKey.gameMode.name}"
            }
            return existing
        }

        val deferred = worldScopeProvider().async {
            starFetchSemaphore.withPermit {
                if (registerForRefresh && cached != null) {
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
                            handleStatsUpdate(cacheKey, entry)
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
                            refreshed?.let { handleStatsUpdate(cacheKey, it) }
                            refreshed
                        }
                        is FetchResult.TemporaryError -> {
                            handleStatsUpdate(cacheKey, cached)
                            null
                        }
                        is FetchResult.PermanentError -> {
                            handleStatsUpdate(cacheKey, cached)
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
                    handleStatsUpdate(cacheKey, null)
                    null
                }
            }
        }

        val previous = inFlightStatsRequests.putIfAbsent(cacheKey, deferred)
        if (previous != null) {
            deferred.cancel()
            if (registerForRefresh && displays.isNotEmpty()) {
                registerDisplaysForRefresh(cacheKey, displays)
            }
            return previous
        }

        deferred.invokeOnCompletion { inFlightStatsRequests.remove(cacheKey, deferred) }
        return deferred
    }

    fun reset() {
        inFlightStatsRequests.values.forEach { it.cancel() }
        inFlightStatsRequests.clear()
        pendingDisplayRefreshes.clear()
        resetFetchTimestamps()
    }

    fun resetFetchTimestamps() {
        lastFetchAttemptAt = 0L
        lastFetchSuccessAt = 0L
    }

    private fun registerDisplaysForRefresh(cacheKey: StatsCacheKey, displays: Collection<LevelheadDisplay>) {
        if (displays.isEmpty()) return
        pendingDisplayRefreshes.compute(cacheKey) { _, existing ->
            val set = existing ?: ConcurrentHashMap.newKeySet<LevelheadDisplay>()
            set.addAll(displays)
            set
        }
    }

    private fun handleStatsUpdate(cacheKey: StatsCacheKey, entry: GameStats?) {
        if (entry != null) {
            repository.put(cacheKey.uuid, cacheKey.gameMode, entry)
            repository.trim(LevelheadConfig.starCacheTtl)
        }
        val listeners = pendingDisplayRefreshes.remove(cacheKey) ?: return
        if (entry != null) {
            listeners
                .filter { it.config.enabled }
                .forEach { display -> onTagUpdate(display, cacheKey.uuid, entry, cacheKey.gameMode) }
        }
    }

    private fun applyStatsToRequests(
        uuid: UUID,
        requests: List<Levelhead.LevelheadRequest>,
        stats: GameStats?
    ) {
        requests.forEach { req ->
            val gameMode = resolveGameMode(req.type)
            val matchingStats = statsForMode(stats, gameMode)
            onTagUpdate(req.display, uuid, matchingStats, gameMode)
        }
    }

    private fun resolveGameMode(typeId: String): GameMode {
        val resolved = GameMode.fromTypeId(typeId) ?: GameMode.BEDWARS
        logger.debug("resolveGameMode: typeId={} -> {}", typeId, resolved)
        return resolved
    }

    private fun statsForMode(stats: GameStats?, gameMode: GameMode): GameStats? {
        val result = when (gameMode) {
            GameMode.BEDWARS -> stats as? GameStats.Bedwars
            GameMode.DUELS -> stats as? GameStats.Duels
            GameMode.SKYWARS -> stats as? GameStats.SkyWars
        }
        logger.debug(
            "statsForMode: inputStatsType={}, requestedGameMode={} -> resultType={} (null means input was null or cast failed)",
            stats?.let { it::class.simpleName }, gameMode, result?.let { it::class.simpleName }
        )
        return result
    }

    private data class PendingStatsRequest(
        val trimmedUuid: String,
        val uuid: UUID,
        val gameMode: GameMode,
        val requests: List<Levelhead.LevelheadRequest>,
        val displays: Set<LevelheadDisplay>,
        val cached: GameStats?,
        val registerForRefresh: Boolean,
        val cacheKey: StatsCacheKey = StatsCacheKey(uuid, gameMode)
    )
}
