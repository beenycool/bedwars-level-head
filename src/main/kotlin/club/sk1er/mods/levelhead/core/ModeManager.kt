package club.sk1er.mods.levelhead.core

import club.sk1er.mods.levelhead.Levelhead
import org.apache.logging.log4j.LogManager

/**
 * Public facade over [ModeTracker].
 *
 * Kept because the `render` and `commands` packages address it. Every method here is now
 * a plain read or an explicit action; nothing detects the mode as a side effect of
 * being read. The actual sampling happens once per 10 ticks in [tracker].
 */
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

    /** Increments once per world join; used to discard queued work from an old world. */
    val worldEpoch: Long
        get() = tracker.worldEpoch

    /** The current mode as of the last sample. Pure read. */
    fun detectActiveMode(): ActiveMode = when (tracker.mode) {
        GameMode.BEDWARS -> ActiveMode.BEDWARS
        GameMode.DUELS -> ActiveMode.DUELS
        GameMode.SKYWARS -> ActiveMode.SKYWARS
        null -> ActiveMode.NONE
    }

    /** Check if the current context is one whose stats should be fetched. */
    fun shouldRequestData(): Boolean {
        if (!Levelhead.isOnHypixel()) return false
        return detectActiveMode() != ActiveMode.NONE
    }

    /** Reset all mode state on world join. */
    fun onWorldJoin() {
        tracker.onWorldJoin()
    }

    /** Force a fresh, main-thread sample (used by the delayed world-join fallback). */
    fun invalidate() {
        tracker.refreshNow()
    }

    /** The current [GameMode], or null when no supported game is proven. Pure read. */
    fun getActiveGameMode(): GameMode? = tracker.mode
}
