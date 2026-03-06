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

    /**
     * Validates and resolves tab string data for a player.
     * Returns null if any validation fails, otherwise returns the tab string.
     */
    private fun resolveTabStringForInfo(info: NetworkPlayerInfo): String? {
        if (!Levelhead.displayManager.config.enabled) return null
        if (!LevelheadConfig.showTabStats) return null
        if (!Levelhead.isOnHypixel()) return null

        val uuid = info.gameProfile.id ?: return null
        if (uuid.version() == 2) return null

        val gameMode = ModeManager.getActiveGameMode() ?: return null
        val stats = Levelhead.getCachedStats(uuid, gameMode) ?: return null
        if (stats.nicked) return null

        return getTabString(stats, gameMode).takeIf { it.isNotBlank() }
    }

    @JvmStatic
    fun getLevelheadWidth(info: NetworkPlayerInfo): Int {
        val tabString = resolveTabStringForInfo(info) ?: return 0
        return Minecraft.getMinecraft().fontRendererObj.getStringWidth(tabString) + 3
    }

    fun getTabString(stats: GameStats, mode: GameMode): String {
        stats.cachedTabString?.let { return it }

        val computed = when (mode) {
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
                val wins = stats.wins
                if (wins == null) {
                    ""
                } else {
                    val divisionTag = DuelsStats.formatDivisionTag(wins)
                    val wlr = DuelsStats.calculateWLR(wins, stats.losses) ?: wins.toDouble()
                    val wlrColor = ratioColor(wlr)
                    "$divisionTag §7: ${wlrColor}${String.format(Locale.ROOT, "%.2f", wlr)}"
                }
            }
            GameMode.SKYWARS -> {
                stats as GameStats.SkyWars
                if (stats.level == null) {
                    ""
                } else {
                    val levelTag = SkyWarsStats.formatLevelTag(stats.levelInt)
                    val kdr = SkyWarsStats.calculateKDR(stats.kills, stats.deaths) ?: (stats.kills ?: 0).toDouble()
                    val kdrColor = ratioColor(kdr)
                    "$levelTag §7: ${kdrColor}${String.format(Locale.ROOT, "%.2f", kdr)}"
                }
            }
        }
        stats.cachedTabString = computed
        return computed
    }

    @JvmStatic
    fun drawPingHook(offset: Int, x: Int, y: Int, info: NetworkPlayerInfo) {
        val tabString = resolveTabStringForInfo(info) ?: return

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
