package club.sk1er.mods.levelhead.core

import club.sk1er.mods.levelhead.Levelhead
import club.sk1er.mods.levelhead.duels.DuelsModeDetector
import club.sk1er.mods.levelhead.skywars.SkyWarsModeDetector

/**
 * Unified manager for detecting which game mode is currently active.
 * Routes to the appropriate mode detector based on the current game state.
 */
object ModeManager {
    private const val TEMP_DEBUG = true
    private var lastLoggedMode: ActiveMode = ActiveMode.NONE
    private var lastLoggedAt: Long = 0L
    
    /**
     * Active game mode context.
     */
    enum class ActiveMode {
        BEDWARS,
        DUELS,
        SKYWARS,
        NONE;
        
        val isActive: Boolean
            get() = this != NONE
    }
    
    /**
     * Detect the currently active game mode.
     * Checks all mode detectors to determine which game is being played.
     */
    fun detectActiveMode(): ActiveMode {
        val bedwarsMatch = BedwarsModeDetector.isInBedwarsMatch()
        val duelsMatch = DuelsModeDetector.isInDuelsMatch()
        val skywarsMatch = SkyWarsModeDetector.isInSkyWarsMatch()
        val bedwars = bedwarsMatch || BedwarsModeDetector.isInBedwars()
        val duels = duelsMatch || DuelsModeDetector.isInDuels()
        val skywars = skywarsMatch || SkyWarsModeDetector.isInSkyWars()
        
        val detected = when {
            // Match contexts are stronger than lobby/chat context and should take priority.
            bedwarsMatch -> ActiveMode.BEDWARS
            duelsMatch && !bedwars -> ActiveMode.DUELS
            skywarsMatch && !bedwars && !duels -> ActiveMode.SKYWARS
            bedwars -> ActiveMode.BEDWARS
            duels && !bedwars -> ActiveMode.DUELS
            skywars && !bedwars && !duels -> ActiveMode.SKYWARS
            else -> ActiveMode.NONE
        }
        
        if (TEMP_DEBUG) {
            val now = System.currentTimeMillis()
            if (detected != lastLoggedMode || now - lastLoggedAt > 5_000L) {
                Levelhead.logger.info(
                    "[TEMP_DEBUG] detectActiveMode: bedwars=$bedwars duels=$duels skywars=$skywars -> $detected"
                )
                lastLoggedMode = detected
                lastLoggedAt = now
            }
        }

        return detected
    }
    
    /**
     * Check if we're currently in any game mode that should display stats.
     */
    fun shouldRequestData(): Boolean {
        return when (detectActiveMode()) {
            ActiveMode.BEDWARS -> BedwarsModeDetector.shouldRequestData()
            ActiveMode.DUELS -> DuelsModeDetector.shouldRequestData()
            ActiveMode.SKYWARS -> SkyWarsModeDetector.shouldRequestData()
            ActiveMode.NONE -> false
        }
    }
    
    /**
     * Check if we should render tags for the current game mode.
     */
    fun shouldRenderTags(): Boolean {
        return when (detectActiveMode()) {
            ActiveMode.BEDWARS -> BedwarsModeDetector.shouldRenderTags()
            ActiveMode.DUELS -> DuelsModeDetector.shouldRenderTags()
            ActiveMode.SKYWARS -> SkyWarsModeDetector.shouldRenderTags()
            ActiveMode.NONE -> false
        }
    }
    
    /**
     * Reset all mode detectors on world join.
     */
    fun onWorldJoin() {
        BedwarsModeDetector.onWorldJoin()
        DuelsModeDetector.onWorldJoin()
        SkyWarsModeDetector.onWorldJoin()
    }
    
    /**
     * Get the GameMode enum for the currently active mode.
     */
    fun getActiveGameMode(): GameMode? {
        return when (detectActiveMode()) {
            ActiveMode.BEDWARS -> GameMode.BEDWARS
            ActiveMode.DUELS -> GameMode.DUELS
            ActiveMode.SKYWARS -> GameMode.SKYWARS
            ActiveMode.NONE -> null
        }
    }
}
