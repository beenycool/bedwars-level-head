package club.sk1er.mods.levelhead.render

import club.sk1er.mods.levelhead.Levelhead
import club.sk1er.mods.levelhead.config.LevelheadConfig
import club.sk1er.mods.levelhead.core.ModeManager
import club.sk1er.mods.levelhead.core.TagFormatter
import club.sk1er.mods.levelhead.display.LevelheadTag
import net.minecraft.client.Minecraft
import net.minecraft.client.network.NetworkPlayerInfo
import net.minecraft.scoreboard.IScoreObjectiveCriteria
import net.minecraft.scoreboard.ScoreObjective
import net.minecraft.util.EnumChatFormatting
import net.minecraft.world.WorldSettings
import java.awt.Color
import java.util.UUID

object TabRender {

    private data class PreparedEntry(val text: String, val width: Int)

    private class FrameState(
        val id: Long,
        val objective: ScoreObjective?,
        val entries: Map<UUID, PreparedEntry>,
        val reservedWidth: Int
    )

    private var frameState: FrameState? = null

    // Bumped at the start of every renderPlayerlist pass. If that method throws,
    // its RETURN hook never calls endFrame(), so state from the aborted pass must
    // be invalidated by id mismatch rather than by relying on the caller.
    private var frameId: Long = 0L

    private val paddingCache = HashMap<Int, String>()
    private const val PADDING_CACHE_LIMIT = 256

    // Widest tag seen this session. Every row is padded to it so a tag arriving
    // later cannot widen the whole tab column mid-game.
    private var reservedWidth = 0

    // Vanilla reserves a fixed column for a HEARTS objective and does not measure
    // the numeric score (GuiPlayerTabOverlay line ~90: l = HEARTS ? 90 : j).
    private const val HEARTS_COLUMN_WIDTH = 90

    @JvmStatic
    fun beginFrame(objective: ScoreObjective?) {
        val id = ++frameId
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

            if (uuid == localPlayerUuid && !tabDisplay.config.showSelf) continue

            val stats = Levelhead.getCachedStats(uuid, mode) ?: continue
            val tag = TagFormatter.formatTag(
                uuid,
                stats,
                tabDisplay.config,
                mode,
                statsVersion = Levelhead.statsStore.version(uuid, mode)
            )
            val text = colorizeTag(tag)
            if (text.isBlank()) continue

            map[uuid] = PreparedEntry(
                text = text,
                width = font.getStringWidth(text) + 3
            )
        }

        val widest = map.values.maxOfOrNull { it.width } ?: 0
        if (widest > reservedWidth) {
            reservedWidth = widest
        }
        frameState = FrameState(id, objective, map, reservedWidth)
    }

    @JvmStatic
    fun endFrame() {
        frameState = null
    }

    @JvmStatic
    fun reset() {
        frameState = null
        reservedWidth = 0
    }

    private fun activeFrame(): FrameState? {
        val state = frameState ?: return null
        return if (state.id == frameId) state else null
    }

    @JvmStatic
    fun getMeasuredName(original: String, info: NetworkPlayerInfo): String {
        val state = activeFrame() ?: return original
        val width = state.reservedWidth
        if (width <= 0) return original

        val spaceWidth = Minecraft.getMinecraft().fontRendererObj.getCharWidth(' ')
        if (spaceWidth <= 0) return original

        val extraSpaces = (width + spaceWidth - 1) / spaceWidth
        if (extraSpaces <= 0) return original
        return original + EnumChatFormatting.RESET.toString() + spaces(extraSpaces)
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
        val state = activeFrame() ?: return
        val entry = state.entries[uuid] ?: return

        val font = Minecraft.getMinecraft().fontRendererObj
        var drawX = offset + x - 12 - entry.width

        val objective = state.objective
        if (objective != null && info.gameType != WorldSettings.GameType.SPECTATOR) {
            if (objective.renderType == IScoreObjectiveCriteria.EnumRenderType.HEARTS) {
                drawX -= HEARTS_COLUMN_WIDTH
            } else {
                val score = Minecraft.getMinecraft().theWorld
                    ?.scoreboard
                    ?.getValueFromObjective(info.gameProfile.name, objective)
                if (score != null) {
                    val scoreStr = " " + EnumChatFormatting.YELLOW.toString() + score.scorePoints
                    drawX -= font.getStringWidth(scoreStr)
                }
            }
        }

        if (Levelhead.displayManager.tab.config.textShadow) {
            font.drawStringWithShadow(entry.text, drawX.toFloat(), y.toFloat(), 0xFFFFFF)
        } else {
            font.drawString(entry.text, drawX.toFloat(), y.toFloat(), 0xFFFFFF, false)
        }
    }

    private fun colorizeTag(tag: LevelheadTag): String {
        return colorToChatFormatting(tag.header.color).toString() + tag.header.value +
            colorToChatFormatting(tag.footer.color).toString() + tag.footer.value
    }

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
