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
import net.minecraft.scoreboard.ScoreObjective
import net.minecraft.util.EnumChatFormatting
import java.util.Locale
import java.util.UUID
import java.util.WeakHashMap

object TabRender {

    private data class PreparedEntry(val text: String, val width: Int)

    private class FrameState(
        val objective: ScoreObjective?,
        val entries: Map<UUID, PreparedEntry>
    )

    private var frameState: FrameState? = null

    private val textCache = mutableMapOf<UUID, Pair<GameStats, String>>()

    /**
     * Called at the start of renderPlayerlist to prepare per-frame tab data.
     * Pre-resolves all player tab strings once, avoiding duplicate work per player.
     */
    @JvmStatic
    fun beginFrame(objective: ScoreObjective?) {
        if (!Levelhead.displayManager.config.enabled ||
            !LevelheadConfig.showTabStats ||
            !Levelhead.isOnHypixel()
        ) {
            frameState = null
            return
        }

        val mode = ModeManager.getActiveGameMode()
        if (mode == null) {
            frameState = null
            return
        }

        val mc = Minecraft.getMinecraft()
        val font = mc.fontRendererObj
        val netHandler = mc.thePlayer?.sendQueue
        if (netHandler == null) {
            frameState = null
            return
        }

        val map = HashMap<UUID, PreparedEntry>()
        for (info in netHandler.playerInfoMap) {
            val uuid = info.gameProfile.id ?: continue
            if (uuid.version() == 2) continue

            val stats = Levelhead.getCachedStats(uuid, mode) ?: continue
            if (stats.nicked) continue

            val text = getOrBuildTabString(uuid, stats, mode)
            if (text.isBlank()) continue

            map[uuid] = PreparedEntry(
                text = text,
                width = font.getStringWidth(text) + 3
            )
        }

        frameState = FrameState(objective, map)
    }

    /**
     * Called at the end of renderPlayerlist to clear per-frame state.
     */
    @JvmStatic
    fun endFrame() {
        frameState = null
    }

    /**
     * Returns extra width needed for the given player's tab stats.
     * Used by the mixin to widen the tab list column.
     */
    @JvmStatic
    fun getLevelheadWidth(info: NetworkPlayerInfo): Int {
        val uuid = info.gameProfile.id ?: return 0
        return frameState?.entries?.get(uuid)?.width ?: 0
    }

    /**
     * Pads the measured player name string with spaces to accommodate tab stats width.
     * Called from the mixin's getPlayerName redirect.
     */
    @JvmStatic
    fun getMeasuredName(original: String, info: NetworkPlayerInfo): String {
        val uuid = info.gameProfile.id ?: return original
        val extraWidth = frameState?.entries?.get(uuid)?.width ?: return original
        if (extraWidth <= 0) return original

        val spaceWidth = Minecraft.getMinecraft().fontRendererObj.getCharWidth(' ')
        if (spaceWidth <= 0) return original

        val spaces = (extraWidth + spaceWidth - 1) / spaceWidth
        return original + " ".repeat(spaces)
    }

    /**
     * Draws the prepared tab string next to the player's ping icon.
     */
    @JvmStatic
    fun drawPrepared(offset: Int, x: Int, y: Int, info: NetworkPlayerInfo) {
        val uuid = info.gameProfile.id ?: return
        val state = frameState ?: return
        val entry = state.entries[uuid] ?: return

        val font = Minecraft.getMinecraft().fontRendererObj
        var drawX = offset + x - 12 - entry.width

        val objective = state.objective
        if (objective != null) {
            val score = Minecraft.getMinecraft().theWorld
                ?.scoreboard
                ?.getValueFromObjective(info.gameProfile.name, objective)
            if (score != null) {
                val scoreStr = " " + EnumChatFormatting.YELLOW.toString() + score.scorePoints
                drawX -= font.getStringWidth(scoreStr)
            }
        }

        font.drawStringWithShadow(entry.text, drawX.toFloat(), y.toFloat(), 0xFFFFFF)
    }

    /**
     * Clears the text formatting cache. Should be called when display config changes.
     */
    fun clearTextCache() {
        textCache.clear()
    }

    private fun getOrBuildTabString(uuid: UUID, stats: GameStats, mode: GameMode): String {
        val cached = textCache[uuid]
        if (cached != null && cached.first === stats) {
            return cached.second
        }
        val newText = formatTabString(stats, mode)
        textCache[uuid] = stats to newText
        return newText
    }

    private fun formatTabString(stats: GameStats, mode: GameMode): String {
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
                if (starTag != null) "$starTag §7: $fkdrPart" else fkdrPart
            }
            GameMode.DUELS -> {
                stats as GameStats.Duels
                val wins = stats.wins ?: return ""
                val divisionTag = DuelsStats.formatDivisionTag(wins)
                val wlr = DuelsStats.calculateWLR(wins, stats.losses) ?: wins.toDouble()
                val wlrColor = ratioColor(wlr)
                "$divisionTag §7: ${wlrColor}${String.format(Locale.ROOT, "%.2f", wlr)}"
            }
            GameMode.SKYWARS -> {
                stats as GameStats.SkyWars
                if (stats.level == null) return ""
                val levelTag = SkyWarsStats.formatLevelTag(stats.levelInt)
                val kdr = SkyWarsStats.calculateKDR(stats.kills, stats.deaths) ?: (stats.kills ?: 0).toDouble()
                val kdrColor = ratioColor(kdr)
                "$levelTag §7: ${kdrColor}${String.format(Locale.ROOT, "%.2f", kdr)}"
            }
        }
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
