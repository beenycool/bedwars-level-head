package club.sk1er.mods.levelhead.core

import club.sk1er.mods.levelhead.Levelhead
import club.sk1er.mods.levelhead.core.DebugLogging.maskForLogs
import kotlinx.coroutines.*
import org.apache.logging.log4j.Logger
import java.util.UUID

class RequestCoordinator(
    private val worldScopeProvider: () -> CoroutineScope,
    private val store: StatsStore,
    private val rateLimiter: RateLimiter,
    private val isOnHypixel: () -> Boolean,
    private val logger: Logger
) {
    private val executor = FetchExecutor(worldScopeProvider, rateLimiter, store, logger)

    val lastAttemptAgeMillis: Long?
        get() = executor.lastAttemptAgeMillis

    val lastSuccessAgeMillis: Long?
        get() = executor.lastSuccessAgeMillis

    fun fetchBatch(requests: List<Levelhead.LevelheadRequest>): Job {
        return worldScopeProvider().launch {
            // Mode reads are now side-effect free, but the Hypixel check still has
            // to run on the client thread. Keep the gate where it always was.
            if (!Levelhead.onMainResult { isOnHypixel() && ModeManager.shouldRequestData() }) return@launch
            if (requests.isEmpty()) return@launch

            val epoch = ModeManager.worldEpoch
            val now = System.currentTimeMillis()
            DebugLogging.logRequestDebug {
                "[LevelheadDebug][plan] ${DebugSession.prefix()} incoming=${requests.size} epoch=$epoch"
            }
            val pending = plan(requests, now)
            DebugLogging.logRequestDebug {
                "[LevelheadDebug][plan] ${DebugSession.prefix()} pending=${pending.size} epoch=$epoch"
            }
            if (pending.isEmpty()) return@launch
            // Check the epoch before marking Loading: a world hop's sweep can run
            // between here and markLoading and would then strand placeholders.
            if (ModeManager.worldEpoch != epoch) return@launch

            pending.forEach { store.markLoading(it.uuid, it.gameMode) }

            // Try the proxy batch first; anything it does not claim falls through
            // to the direct path (which dedupes against in-flight work).
            val remaining = executor.executeProxyBatch(pending, ::recordResult)
            DebugLogging.logRequestDebug {
                "[LevelheadDebug][plan] ${DebugSession.prefix()} proxyRemaining=${remaining.size} pending=${pending.size}"
            }
            if (remaining.isEmpty()) return@launch
            if (ModeManager.worldEpoch != epoch) return@launch

            remaining
                .map { executor.ensureStatsFetch(it, ::recordResult) }
                .awaitAll()
        }
    }

    private fun plan(requests: List<Levelhead.LevelheadRequest>, now: Long): List<FetchWork> {
        val pending = mutableListOf<FetchWork>()
        val uniqueCount = requests.map { it.uuid }.toSet().size
        val reasonCounts = requests.groupBy { it.reason }.mapValues { it.value.size }
        var hits = 0
        var stale = 0
        var misses = 0
        var loadingSkips = 0
        requests
            .groupBy { it.uuid }
            .forEach { (trimmedUuid, groupedRequests) ->
                val uuid = trimmedUuid.dashUUID ?: return@forEach
                groupedRequests
                    .groupBy { GameMode.resolve(it.type, logger) }
                    .forEach modeLoop@ { (gameMode, modeRequests) ->
                        // A slow request already owns this key. Skipping it before
                        // lookup() keeps the poll from enqueueing a duplicate (and
                        // from recording a miss that is really in-flight work).
                        if (store.isLoading(uuid, gameMode, now)) {
                            loadingSkips++
                            return@modeLoop
                        }
                        val lookup = store.lookup(uuid, gameMode, now)
                        val debug = DebugLogging.isRequestDebugEnabled()
                        val maskedUuid = if (debug) uuid.maskForLogs() else null
                        val reasons = if (debug) modeRequests.map { it.reason }.toSet() else null

                        when (lookup) {
                            StatsLookup.HIT -> {
                                hits++
                                DebugLogging.logRequestDebug {
                                    "[LevelheadDebug][store] HIT: uuid=$maskedUuid mode=${gameMode.name} reasons=$reasons"
                                }
                            }
                            StatsLookup.STALE -> {
                                stale++
                                DebugLogging.logRequestDebug {
                                    "[LevelheadDebug][store] STALE refresh: uuid=$maskedUuid mode=${gameMode.name} reasons=$reasons"
                                }
                                pending += FetchWork(uuid, gameMode, store.get(uuid, gameMode))
                            }
                            StatsLookup.MISS -> {
                                misses++
                                DebugLogging.logRequestDebug {
                                    "[LevelheadDebug][store] MISS: uuid=$maskedUuid mode=${gameMode.name} reasons=$reasons"
                                }
                                pending += FetchWork(uuid, gameMode, null)
                            }
                        }
                    }
            }
        DebugSession.inc("plan_requests", requests.size)
        DebugSession.inc("plan_unique", uniqueCount)
        DebugSession.inc("plan_pending", pending.size)
        DebugSession.inc("plan_hit", hits)
        DebugSession.inc("plan_stale", stale)
        DebugSession.inc("plan_miss", misses)
        DebugSession.inc("plan_loading_skip", loadingSkips)
        DebugLogging.logRequestDebug {
            "[LevelheadDebug][plan] ${DebugSession.prefix()} incoming=${requests.size} unique=$uniqueCount pending=${pending.size} hit=$hits stale=$stale miss=$misses loadingSkip=$loadingSkips reasons=$reasonCounts"
        }
        return pending
    }

    private fun recordResult(key: StatsKey, stats: GameStats?) {
        if (stats != null) {
            store.putSuccess(key.uuid, key.gameMode, stats)
        } else {
            store.putFailure(
                key.uuid,
                key.gameMode,
                FetchBackoff.nextAttemptAt(key.uuid) ?: System.currentTimeMillis()
            )
        }
    }

    fun reset() {
        executor.reset()
        // executor.reset() cancels the coroutines that owned any in-flight keys, so
        // their Loading placeholders no longer describe real work.
        store.clearLoading()
    }

    fun resetFetchTimestamps() {
        executor.resetFetchTimestamps()
    }
}
