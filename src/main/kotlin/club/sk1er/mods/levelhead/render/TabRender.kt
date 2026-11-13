package club.sk1er.mods.levelhead.render

import club.sk1er.mods.levelhead.Levelhead
import club.sk1er.mods.levelhead.config.LevelheadConfig
import club.sk1er.mods.levelhead.core.DebugLogging
import club.sk1er.mods.levelhead.core.DebugLogging.maskForLogs
import club.sk1er.mods.levelhead.core.DebugLogging.truncateForLogs
import club.sk1er.mods.levelhead.core.ModeManager
import club.sk1er.mods.levelhead.core.TagFormatter
import club.sk1er.mods.levelhead.display.LevelheadTag
import net.minecraft.client.Minecraft
import net.minecraft.client.network.NetworkPlayerInfo
import net.minecraft.scoreboard.ScoreObjective
import net.minecraft.util.EnumChatFormatting
import java.awt.Color
import java.util.UUID

/**
 * Tab list rendering.
 *
 * Semantics:
 * - Tags are derived from [club.sk1er.mods.levelhead.core.StatsStore] through the
 *   same memoised [TagFormatter] call the nametag uses. There is no separate tab
 *   tag cache and therefore no second format to drift (B29).
 * - [club.sk1er.mods.levelhead.display.TabDisplay.config] supplies the tab header
 *   settings and a non-blank `footerString` ("Tab Footer Format"), which overrides
 *   the global per-mode footer template for tab tags only.
 * - Component colours come from the stat formatter: the BedWars prestige / SkyWars
 *   level colour, or the Duels division colour when the footer shows a division.
 * - A player with no stats renders nothing; that is the only "unknown" state.
 */
object TabRender {

    private data class PreparedEntry(val text: String, val width: Int)

    private class FrameState(
        val objective: ScoreObjective?,
        val entries: Map<UUID, PreparedEntry>
    )

    private var frameState: FrameState? = null

    /**
     * Cache of padding runs keyed by space count. [getMeasuredName] runs for every row
     * of the tab list on every frame, so rebuilding an identical run of spaces for each
     * player is pure allocation (B31). Bounded, and cleared when it fills up.
     */
    private val paddingCache = HashMap<Int, String>()
    private const val PADDING_CACHE_LIMIT = 256

    @JvmStatic
    fun beginFrame(objective: ScoreObjective?) {
        if (!Levelhead.displayManager.config.enabled) {
            frameState = null
            return
        }
        if (!LevelheadConfig.showTabStats) {
            frameState = null
            return
        }
        if (!Levelhead.isOnHypixel()) {
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

        val tabDisplay = Levelhead.displayManager.tab
        val localPlayerUuid = mc.thePlayer?.uniqueID

        val map = HashMap<UUID, PreparedEntry>()
        for (info in netHandler.playerInfoMap) {
            val uuid = info.gameProfile.id ?: continue
            if (uuid.version() == 2) continue

            // Skip self if tab showSelf is disabled
            if (uuid == localPlayerUuid && !tabDisplay.config.showSelf) continue

            // The same formatter call as the nametag, so text and width are
            // identical between the two renderers (B29).
            val stats = Levelhead.getCachedStats(uuid, mode) ?: continue
            val tag = TagFormatter.formatTag(
                uuid,
                stats,
                tabDisplay.config,
                mode,
                preferDisplayFooter = true,
                statsVersion = Levelhead.statsStore.version(uuid, mode)
            )
            val text = colorizeTag(tag)
            if (text.isBlank()) continue

            map[uuid] = PreparedEntry(
                text = text,
                width = font.getStringWidth(text) + 3
            )
        }

        DebugLogging.logTabDebug { "[LevelheadDebug][tab] beginFrame prepared=${map.size} mode=$mode" }
        frameState = FrameState(objective, map)
    }

    @JvmStatic
    fun endFrame() {
        frameState = null
    }

    @JvmStatic
    fun getMeasuredName(original: String, info: NetworkPlayerInfo): String {
        val uuid = info.gameProfile.id ?: return original
        val entry = frameState?.entries?.get(uuid) ?: return original
        if (entry.width <= 0) return original

        val spaceWidth = Minecraft.getMinecraft().fontRendererObj.getCharWidth(' ')
        if (spaceWidth <= 0) return original

        val extraSpaces = (entry.width + spaceWidth - 1) / spaceWidth
        if (extraSpaces <= 0) return original
        val padded = original + spaces(extraSpaces)

        DebugLogging.logTabDebug { "[LevelheadDebug][tab] getMeasuredName uuid=${uuid.maskForLogs()} extraWidth=${entry.width} spaces=$extraSpaces" }
        return padded
    }

    private fun spaces(count: Int): String {
        paddingCache[count]?.let { return it }
        val value = " ".repeat(count)
        if (paddingCache.size >= PADDING_CACHE_LIMIT) {
            paddingCache.clear()
        }
        paddingCache[count] = value
        return value
    }

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

        DebugLogging.logTabDebug { "[LevelheadDebug][tab] drawPrepared uuid=${uuid.maskForLogs()} text='${entry.text.truncateForLogs(40)}' drawX=$drawX y=$y" }
        font.drawStringWithShadow(entry.text, drawX.toFloat(), y.toFloat(), 0xFFFFFF)
    }

    /**
     * Colour a cached tag with its own component colours. A leading colour code is
     * prepended per component; a component that already carries inline `§` codes
     * keeps them (inline codes win over the prepended prefix).
     */
    private fun colorizeTag(tag: LevelheadTag): String {
        return colorToChatFormatting(tag.header.color).toString() + tag.header.value +
            colorToChatFormatting(tag.footer.color).toString() + tag.footer.value
    }

    /**
     * Vanilla's 16 chat colours, built once: this is called twice per player per
     * frame, so the table is not rebuilt per call (B31).
     */
    private val CHAT_COLORS: Array<Pair<EnumChatFormatting, Color>> = arrayOf(
        EnumChatFormatting.BLACK to Color(0, 0, 0),
        EnumChatFormatting.DARK_BLUE to Color(0, 0, 170),
        EnumChatFormatting.DARK_GREEN to Color(0, 170, 0),
        EnumChatFormatting.DARK_AQUA to Color(0, 170, 170),
        EnumChatFormatting.DARK_RED to Color(170, 0, 0),
        EnumChatFormatting.DARK_PURPLE to Color(170, 0, 170),
        EnumChatFormatting.GOLD to Color(255, 170, 0),
        EnumChatFormatting.GRAY to Color(170, 170, 170),
        EnumChatFormatting.DARK_GRAY to Color(85, 85, 85),
        EnumChatFormatting.BLUE to Color(85, 85, 255),
        EnumChatFormatting.GREEN to Color(85, 255, 85),
        EnumChatFormatting.AQUA to Color(85, 255, 255),
        EnumChatFormatting.RED to Color(255, 85, 85),
        EnumChatFormatting.LIGHT_PURPLE to Color(255, 85, 255),
        EnumChatFormatting.YELLOW to Color(255, 255, 85),
        EnumChatFormatting.WHITE to Color(255, 255, 255)
    )

    /**
     * Map an AWT Color to the closest Minecraft chat formatting color code.
     * Uses Euclidean distance in RGB space for best match.
     */
    private fun colorToChatFormatting(color: Color): EnumChatFormatting {
        var best = EnumChatFormatting.WHITE
        var bestDist = Int.MAX_VALUE
        for ((fmt, c) in CHAT_COLORS) {
            val dr = color.red - c.red
            val dg = color.green - c.green
            val db = color.blue - c.blue
            val dist = dr * dr + dg * dg + db * db
            if (dist < bestDist) {
                bestDist = dist
                best = fmt
            }
        }
        return best
    }
}
