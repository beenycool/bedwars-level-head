package club.sk1er.mods.levelhead.core

import club.sk1er.mods.levelhead.Levelhead
import club.sk1er.mods.levelhead.config.LevelheadConfig
import club.sk1er.mods.levelhead.display.LevelheadDisplay
import org.apache.logging.log4j.Logger
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

class CacheApplier(
    private val repository: StatsRepository,
    private val onTagUpdate: (display: LevelheadDisplay, uuid: UUID, stats: GameStats?, gameMode: GameMode) -> Unit,
    private val logger: Logger
) {
    private val pendingDisplayRefreshes: ConcurrentHashMap<StatsCacheKey, MutableSet<LevelheadDisplay>> = ConcurrentHashMap()

    fun registerDisplaysForRefresh(cacheKey: StatsCacheKey, displays: Collection<LevelheadDisplay>) {
        if (displays.isEmpty()) return
        pendingDisplayRefreshes.compute(cacheKey) { _, existing ->
            val set = existing ?: ConcurrentHashMap.newKeySet<LevelheadDisplay>()
            set.addAll(displays)
            set
        }
    }

    fun handleStatsUpdate(cacheKey: StatsCacheKey, entry: GameStats?) {
        if (entry != null) {
            repository.put(cacheKey.uuid, cacheKey.gameMode, entry)
            repository.trimIfNeeded(LevelheadConfig.starCacheTtl)
        }
        val listeners = pendingDisplayRefreshes.remove(cacheKey) ?: return
        if (entry != null) {
            listeners
                .filter { it.config.enabled }
                .forEach { display -> onTagUpdate(display, cacheKey.uuid, entry, cacheKey.gameMode) }
        }
    }

    fun applyStatsToRequests(
        uuid: UUID,
        requests: List<Levelhead.LevelheadRequest>,
        stats: GameStats?
    ) {
        requests.forEach { req ->
            val gameMode = resolveGameMode(req.type)
            val matchingStats = statsForMode(stats, gameMode)
            req.displays.forEach { display ->
                onTagUpdate(display, uuid, matchingStats, gameMode)
            }
        }
    }

    fun reset() {
        pendingDisplayRefreshes.clear()
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
}
