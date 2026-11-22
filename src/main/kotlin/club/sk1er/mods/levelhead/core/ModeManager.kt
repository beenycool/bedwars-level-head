package club.sk1er.mods.levelhead.core

import club.sk1er.mods.levelhead.Levelhead
import club.sk1er.mods.levelhead.config.LevelheadConfig
import org.apache.logging.log4j.LogManager

object ModeManager {
    enum class ActiveMode {
        BEDWARS,
        DUELS,
        SKYWARS,
        NONE
    }

    val tracker: ModeTracker = ModeTracker(
        onRequestAllDisplays = { visible -> Levelhead.displayManager.requestAllDisplays(visible) },
        onClearDisplays = { Levelhead.displayManager.clearCachesWithoutRefetch(clearStats = false) },
        logger = LogManager.getLogger("LevelheadMode")
    )

    val worldEpoch: Long
        get() = tracker.worldEpoch

    fun detectActiveMode(): ActiveMode {
        val forced = forcedGameMode()
        if (forced != null) {
            return when (forced) {
                GameMode.BEDWARS -> ActiveMode.BEDWARS
                GameMode.DUELS -> ActiveMode.DUELS
                GameMode.SKYWARS -> ActiveMode.SKYWARS
            }
        }
        return when (tracker.mode) {
            GameMode.BEDWARS -> ActiveMode.BEDWARS
            GameMode.DUELS -> ActiveMode.DUELS
            GameMode.SKYWARS -> ActiveMode.SKYWARS
            null -> ActiveMode.NONE
        }
    }

    fun shouldRequestData(): Boolean {
        if (!Levelhead.isOnHypixel()) return false
        return detectActiveMode() != ActiveMode.NONE
    }

    fun onWorldJoin() {
        tracker.onWorldJoin()
    }

    fun invalidate() {
        tracker.refreshNow()
    }

    fun getActiveGameMode(): GameMode? = forcedGameMode() ?: tracker.mode

    fun isHub(): Boolean = tracker.isHub

    private fun forcedGameMode(): GameMode? = when (LevelheadConfig.modeOverrideIndex) {
        1 -> GameMode.BEDWARS
        2 -> GameMode.DUELS
        3 -> GameMode.SKYWARS
        else -> null
    }
}
