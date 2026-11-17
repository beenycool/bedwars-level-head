package club.sk1er.mods.levelhead.core

import club.sk1er.mods.levelhead.Levelhead
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

    fun detectActiveMode(): ActiveMode = when (tracker.mode) {
        GameMode.BEDWARS -> ActiveMode.BEDWARS
        GameMode.DUELS -> ActiveMode.DUELS
        GameMode.SKYWARS -> ActiveMode.SKYWARS
        null -> ActiveMode.NONE
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

    fun getActiveGameMode(): GameMode? = tracker.mode
}
