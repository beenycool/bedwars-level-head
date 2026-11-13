package club.sk1er.mods.levelhead.core

import club.sk1er.mods.levelhead.Levelhead
import club.sk1er.mods.levelhead.core.DebugLogging.maskForLogs
import kotlinx.coroutines.*
import org.apache.logging.log4j.Logger
import java.util.UUID

/**
 * Turns a batch of queued requests into at most one batch request plus direct
 * lookups for whatever the batch did not claim.
 *
 * This used to be three layers (`FetchPlanner` -> `CacheApplier` -> `FetchExecutor`)
 * around one map. Planning is now just "ask [StatsStore] what it has"; applying a
 * result is just "write it back". Nothing here touches a display.
 */
class RequestCoordinator(
    private val worldScopeProvider: () -> CoroutineScope,
    private val store: StatsStore,
    private val rateLimiter: RateLimiter,
    private val isOnHypixel: () -> Boolean,
    private val logger: Logger
) {
    private val executor = FetchExecutor(worldScopeProvider, rateLimiter, logger)

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
            val pending = plan(requests, now)
            if (pending.isEmpty()) return@launch

            pending.forEach { store.markLoading(it.uuid, it.gameMode) }
            if (ModeManager.worldEpoch != epoch) return@launch

            // Try the proxy batch first; anything it does not claim falls through
            // to the direct path (which dedupes against in-flight work).
            val remaining = executor.executeProxyBatch(pending, ::recordResult)
            if (remaining.isEmpty()) return@launch
            if (ModeManager.worldEpoch != epoch) return@launch

            remaining
                .map { executor.ensureStatsFetch(it, ::recordResult) }
                .awaitAll()
        }
    }

    /**
     * Group requests by player/mode and keep only what the store cannot serve
     * fresh. Stale entries are returned as well: they render while the refresh is
     * in flight, exactly like the old expired-refresh plan.
     */
    private fun plan(requests: List<Levelhead.LevelheadRequest>, now: Long): List<FetchWork> {
        val pending = mutableListOf<FetchWork>()
        requests
            .groupBy { it.uuid }
            .forEach { (trimmedUuid, groupedRequests) ->
                val uuid = trimmedUuid.dashUUID ?: return@forEach
                groupedRequests
                    .groupBy { GameMode.resolve(it.type, logger) }
                    .forEach { (gameMode, modeRequests) ->
                        val lookup = store.lookup(uuid, gameMode, now)
                        val debug = DebugLogging.isRequestDebugEnabled()
                        val maskedUuid = if (debug) uuid.maskForLogs() else null
                        val reasons = if (debug) modeRequests.map { it.reason }.toSet() else null

                        when (lookup) {
                            StatsLookup.HIT -> {
                                DebugLogging.logRequestDebug {
                                    "[LevelheadDebug][store] HIT: uuid=$maskedUuid mode=${gameMode.name} reasons=$reasons"
                                }
                            }
                            StatsLookup.STALE -> {
                                DebugLogging.logRequestDebug {
                                    "[LevelheadDebug][store] STALE refresh: uuid=$maskedUuid mode=${gameMode.name} reasons=$reasons"
                                }
                                pending += FetchWork(uuid, gameMode, store.get(uuid, gameMode))
                            }
                            StatsLookup.MISS -> {
                                DebugLogging.logRequestDebug {
                                    "[LevelheadDebug][store] MISS: uuid=$maskedUuid mode=${gameMode.name} reasons=$reasons"
                                }
                                pending += FetchWork(uuid, gameMode, null)
                            }
                        }
                    }
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
    }

    fun resetFetchTimestamps() {
        executor.resetFetchTimestamps()
    }
}
