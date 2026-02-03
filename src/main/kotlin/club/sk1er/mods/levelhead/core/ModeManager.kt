package club.sk1er.mods.levelhead.core

object ModeManager {
    fun onWorldJoin() {
        BedwarsModeDetector.onWorldJoin()
    }

    fun getActiveGameMode(): GameMode? {
        return when {
            BedwarsModeDetector.currentContext().isBedwars -> GameMode.BEDWARS
            else -> null
        }
    }

    fun shouldRequestData(): Boolean {
        return BedwarsModeDetector.shouldRequestData()
    }

    fun shouldRenderTags(): Boolean {
        return BedwarsModeDetector.shouldRenderTags()
    }
}
