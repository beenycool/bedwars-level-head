package club.sk1er.mods.levelhead.render

import club.sk1er.mods.levelhead.Levelhead
import club.sk1er.mods.levelhead.config.LevelheadConfig
import club.sk1er.mods.levelhead.core.BedwarsStar
import club.sk1er.mods.levelhead.core.GameMode
import club.sk1er.mods.levelhead.core.GameStats
import club.sk1er.mods.levelhead.core.ModeManager
import club.sk1er.mods.levelhead.duels.DuelsStats
import club.sk1er.mods.levelhead.skywars.SkyWarsStats
import net.minecraft.client.Minecraft
import net.minecraft.client.network.NetworkPlayerInfo
import net.minecraft.util.EnumChatFormatting
import java.util.Locale

object TabRender {

    @JvmStatic
    fun getLevelheadWidth(info: NetworkPlayerInfo): Int {
        if (!Levelhead.displayManager.config.enabled) return 0
        if (!LevelheadConfig.showTabStats) return 0
        if (!Levelhead.isOnHypixel()) return 0

        val uuid = info.gameProfile.id ?: return 0
        if (uuid.version() == 2) return 0

        val gameMode = ModeManager.getActiveGameMode() ?: return 0
        val stats = Levelhead.getCachedStats(uuid, gameMode) ?: return 0
        if (stats.nicked) return 0

        val tabString = getTabString(stats, gameMode)
        if (tabString.isBlank()) return 0

        return Minecraft.getMinecraft().fontRendererObj.getStringWidth(tabString) + 3
    }

    fun getTabString(stats: GameStats, mode: GameMode): String {
        return when (mode) {
            GameMode.BEDWARS -> {
                stats as GameStats.Bedwars
                val starTag = stats.star?.let { BedwarsStar.formatStarTag(it) }
                val fkdrPart = if (stats.fkdr != null) {
                    val color = ratioColor(stats.fkdr)
                    "${color}${String.format(Locale.ROOT, "%.2f", stats.fkdr)}"
                } else {
                    "§7?"
                }
                if (starTag != null) {
                    "$starTag §7: $fkdrPart"
                } else {
                    fkdrPart
                }
            }
            GameMode.DUELS -> {
                stats as GameStats.Duels
                val wins = stats.wins ?: return ""
                val divisionTag = DuelsStats.formatDivisionTag(wins)
                val losses = stats.losses ?: 0
                val wlr = if (losses <= 0) wins.toDouble() else wins.toDouble() / losses.toDouble()
                val wlrColor = ratioColor(wlr)
                "$divisionTag §7: ${wlrColor}${String.format(Locale.ROOT, "%.2f", wlr)}"
            }
            GameMode.SKYWARS -> {
                stats as GameStats.SkyWars
                if (stats.level == null) return ""
                val levelTag = SkyWarsStats.formatLevelTag(stats.levelInt)
                val kills = stats.kills ?: 0
                val deaths = stats.deaths ?: 0
                val kdr = if (deaths <= 0) kills.toDouble() else kills.toDouble() / deaths.toDouble()
                val kdrColor = ratioColor(kdr)
                "$levelTag §7: ${kdrColor}${String.format(Locale.ROOT, "%.2f", kdr)}"
            }
        }
    }

    @JvmStatic
    fun drawPingHook(offset: Int, x: Int, y: Int, info: NetworkPlayerInfo) {
        if (!Levelhead.displayManager.config.enabled) return
        if (!LevelheadConfig.showTabStats) return
        if (!Levelhead.isOnHypixel()) return

        val uuid = info.gameProfile.id ?: return
        if (uuid.version() == 2) return

        val gameMode = ModeManager.getActiveGameMode() ?: return
        val stats = Levelhead.getCachedStats(uuid, gameMode) ?: return
        if (stats.nicked) return

        val tabString = getTabString(stats, gameMode)
        if (tabString.isBlank()) return

        val fontRenderer = Minecraft.getMinecraft().fontRendererObj
        var drawX = offset + x - 12 - fontRenderer.getStringWidth(tabString)

        val objective = Minecraft.getMinecraft().theWorld?.scoreboard?.getObjectiveInDisplaySlot(0)
        if (objective != null) {
            val score = Minecraft.getMinecraft().theWorld?.scoreboard?.getValueFromObjective(info.gameProfile.name, objective)
            if (score != null) {
                val scoreStr = " " + EnumChatFormatting.YELLOW.toString() + score.scorePoints
                drawX -= fontRenderer.getStringWidth(scoreStr)
            }
        }

        fontRenderer.drawStringWithShadow(tabString, drawX.toFloat(), y.toFloat(), 0xFFFFFF)
    }

    private fun ratioColor(value: Double): String {
        return when {
            value >= 10.0 -> "§6"
            value >= 6.0 -> "§e"
            value >= 3.0 -> "§a"
            value >= 1.0 -> "§f"
            else -> "§7"
        }
    }
}
