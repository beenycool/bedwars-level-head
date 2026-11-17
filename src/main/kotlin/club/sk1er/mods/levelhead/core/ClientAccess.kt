package club.sk1er.mods.levelhead.core

import club.sk1er.mods.levelhead.config.LevelheadConfig
import net.minecraft.client.Minecraft
import net.minecraft.scoreboard.Scoreboard
import java.util.Locale
import java.util.UUID

object ClientAccess {
    private val defaultScoreboardProvider: () -> Scoreboard? = {
        Minecraft.getMinecraft()?.theWorld?.scoreboard
    }

    private val defaultHypixelServerCheck: () -> Boolean = {
        if (LevelheadConfig.forceEnabled) {
            true
        } else {
            val mc = Minecraft.getMinecraft()
            when {
                mc == null || mc.isSingleplayer -> false
                else -> mc.currentServerData?.serverIP
                    ?.lowercase(Locale.ROOT)
                    ?.contains("hypixel") == true
            }
        }
    }

    private val defaultVisiblePlayerIds: () -> List<UUID> = {
        Minecraft.getMinecraft()?.theWorld?.playerEntities
            ?.map { it.uniqueID }
            ?.filter { it.version() != 2 }
            ?: emptyList()
    }

    var scoreboardProvider: () -> Scoreboard? = defaultScoreboardProvider

    var hypixelServerCheck: () -> Boolean = defaultHypixelServerCheck

    var visiblePlayerIds: () -> List<UUID> = defaultVisiblePlayerIds

    fun reset() {
        scoreboardProvider = defaultScoreboardProvider
        hypixelServerCheck = defaultHypixelServerCheck
        visiblePlayerIds = defaultVisiblePlayerIds
    }
}
