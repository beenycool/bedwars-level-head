package club.sk1er.mods.levelhead.core

import club.sk1er.mods.levelhead.Levelhead
import club.sk1er.mods.levelhead.config.LevelheadConfig
import club.sk1er.mods.levelhead.core.DebugLogging.maskForLogs
import club.sk1er.mods.levelhead.core.DebugLogging.maskIfUuid
import club.sk1er.mods.levelhead.display.LevelheadDisplay
import org.apache.logging.log4j.Logger
import java.util.UUID

enum class CacheState { HIT, EXPIRED, COLD }

data class PlannedFetch(
    val trimmedUuid: String,
    val uuid: UUID,
    val gameMode: GameMode,
    val requests: List<Levelhead.LevelheadRequest>,
    val displays: Set<LevelheadDisplay>,
    val cached: GameStats?,
    val state: CacheState,
    val cacheKey: StatsCacheKey = StatsCacheKey(uuid, gameMode)
) {
    val shouldFetch: Boolean get() = state != CacheState.HIT
    val shouldServeImmediately: Boolean get() = cached != null
    val shouldRegisterRefresh: Boolean get() = state == CacheState.EXPIRED
}

data class FetchPlan(
    val immediate: List<PlannedFetch>,
    val pending: List<PlannedFetch>
)

class FetchPlanner(
    private val repository: StatsRepository,
    private val logger: Logger
) {
    fun plan(requests: List<Levelhead.LevelheadRequest>, now: Long = System.currentTimeMillis()): FetchPlan {
        val immediate = mutableListOf<PlannedFetch>()
        val pending = mutableListOf<PlannedFetch>()

        requests
            .groupBy { it.uuid }
            .forEach { (trimmedUuid, groupedRequests) ->
                val uuid = trimmedUuid.dashUUID ?: return@forEach
                groupedRequests
                    .groupBy { GameMode.resolve(it.type, logger) }
                    .forEach { (gameMode, modeRequests) ->
                        val debug = DebugLogging.isRequestDebugEnabled()
                        val displays = modeRequests.flatMap { it.displays }.toSet()
                        val cached = repository.peek(uuid, gameMode)
                        val reasons = if (debug) modeRequests.map { it.reason }.toSet() else null
                        val maskedUuid = if (debug) uuid.maskForLogs() else null
                        val trimmedMasked = if (debug) trimmedUuid.maskIfUuid() else null

                        when {
                            cached == null -> {
                                PerformanceMetrics.recordCacheLookup(hit = false)
                                repository.recordMiss(CacheMissReason.COLD)
                                DebugLogging.logRequestDebug {
                                    "[LevelheadDebug][cache] COLD miss: uuid=$maskedUuid trimmed=$trimmedMasked mode=${gameMode.name} reasons=$reasons"
                                }
                                val planned = PlannedFetch(trimmedUuid, uuid, gameMode, modeRequests, displays, cached, CacheState.COLD)
                                pending += planned
                                DebugLogging.logRequestDebug {
                                    "[LevelheadDebug][request] fetch initiated: uuid=$maskedUuid trimmed=$trimmedMasked mode=${gameMode.name} reason=COLD_MISS"
                                }
                            }
                            cached.isExpired(LevelheadConfig.starCacheTtl, now) -> {
                                PerformanceMetrics.recordCacheLookup(hit = false)
                                repository.recordMiss(CacheMissReason.EXPIRED)
                                DebugLogging.logRequestDebug {
                                    "[LevelheadDebug][cache] EXPIRED refresh: uuid=$maskedUuid trimmed=$trimmedMasked mode=${gameMode.name} reasons=$reasons"
                                }
                                val planned = PlannedFetch(trimmedUuid, uuid, gameMode, modeRequests, displays, cached, CacheState.EXPIRED)
                                immediate += planned
                                pending += planned
                                DebugLogging.logRequestDebug {
                                    "[LevelheadDebug][request] fetch initiated: uuid=$maskedUuid trimmed=$trimmedMasked mode=${gameMode.name} reason=EXPIRED_REFRESH"
                                }
                            }
                            else -> {
                                PerformanceMetrics.recordCacheLookup(hit = true)
                                PerformanceMetrics.recordCacheAge(now - cached.fetchedAt)
                                val planned = PlannedFetch(trimmedUuid, uuid, gameMode, modeRequests, displays, cached, CacheState.HIT)
                                immediate += planned
                                DebugLogging.logRequestDebug {
                                    "[LevelheadDebug][cache] HIT: uuid=$maskedUuid trimmed=$trimmedMasked mode=${gameMode.name} reasons=$reasons"
                                }
                            }
                        }
                    }
            }

        return FetchPlan(immediate, pending)
    }
}
