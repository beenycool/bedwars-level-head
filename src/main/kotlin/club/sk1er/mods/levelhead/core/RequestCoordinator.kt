package club.sk1er.mods.levelhead.core

import club.sk1er.mods.levelhead.Levelhead
import club.sk1er.mods.levelhead.display.LevelheadDisplay
import kotlinx.coroutines.*
import org.apache.logging.log4j.Logger
import java.util.UUID

class RequestCoordinator(
    private val worldScopeProvider: () -> CoroutineScope,
    private val repository: StatsRepository,
    private val rateLimiter: RateLimiter,
    private val isOnHypixel: () -> Boolean,
    private val onTagUpdate: (display: LevelheadDisplay, uuid: UUID, stats: GameStats?, gameMode: GameMode) -> Unit,
    private val logger: Logger
) {
    private val planner = FetchPlanner(repository, logger)
    private val applier = CacheApplier(repository, onTagUpdate, logger)
    private val executor = FetchExecutor(worldScopeProvider, rateLimiter, logger)

    val lastAttemptAgeMillis: Long?
        get() = executor.lastAttemptAgeMillis

    val lastSuccessAgeMillis: Long?
        get() = executor.lastSuccessAgeMillis

    fun fetchBatch(requests: List<Levelhead.LevelheadRequest>): Job {
        return worldScopeProvider().launch {
            if (!isOnHypixel()) return@launch
            if (requests.isEmpty()) return@launch

            val plan = planner.plan(requests, System.currentTimeMillis())

            // Serve cached results immediately (HITs and stale EXPIRED entries)
            plan.immediate.forEach { entry ->
                applier.applyStatsToRequests(entry.uuid, entry.requests, entry.cached)
            }

            if (plan.pending.isEmpty()) return@launch
            if (!ModeManager.shouldRequestData()) return@launch

            // Register expired entries for display refresh before fetching
            plan.pending
                .filter { it.shouldRegisterRefresh && it.displays.isNotEmpty() }
                .forEach { applier.registerDisplaysForRefresh(it.cacheKey, it.displays) }

            // Try proxy batch first, get remaining entries that need direct fetch
            val remaining = executor.executeProxyBatch(plan.pending, applier::handleStatsUpdate)

            // Apply proxy results to requests for entries that were handled
            plan.pending.forEach { entry ->
                if (entry !in remaining) {
                    applier.applyStatsToRequests(entry.uuid, entry.requests,
                        repository.peek(entry.uuid, entry.gameMode))
                }
            }

            if (remaining.isEmpty()) return@launch

            // Direct fetch for remaining entries
            val deferredFetches = remaining.map { entry ->
                entry to executor.ensureStatsFetch(entry.cacheKey, entry.cached, applier::handleStatsUpdate)
            }
            val fetchedResults = deferredFetches.map { it.second }.awaitAll()
            deferredFetches.zip(fetchedResults).forEach { (entryWithDeferred, fetched) ->
                val entry = entryWithDeferred.first
                applier.applyStatsToRequests(entry.uuid, entry.requests, fetched)
            }
        }
    }

    fun reset() {
        executor.reset()
        applier.reset()
    }

    fun resetFetchTimestamps() {
        executor.resetFetchTimestamps()
    }
}
