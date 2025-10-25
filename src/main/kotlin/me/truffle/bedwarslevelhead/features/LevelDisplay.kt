package me.truffle.bedwarslevelhead.features

import me.truffle.bedwarslevelhead.BedwarsLevelHead
import me.truffle.bedwarslevelhead.data.LevelCache
import me.truffle.bedwarslevelhead.utils.ColorUtils
import net.minecraft.client.Minecraft
import net.minecraft.client.entity.AbstractClientPlayer
import net.minecraft.client.gui.FontRenderer

object LevelDisplay {

    fun renderLevelForPlayer(player: AbstractClientPlayer, x: Double, y: Double, z: Double) {
        val mc = Minecraft.getMinecraft()
        val playerName = player.name

        // Don't show own level if disabled
        if (player == mc.thePlayer && !BedwarsLevelHead.config.showOwnLevel) {
            return
        }

        val levelData = LevelCache.getPlayerLevel(playerName) ?: return
        val levelText = formatLevelText(levelData.level)

        renderLevelText(levelText, x, y, z)
    }

    private fun formatLevelText(level: Int): String {
        var format = BedwarsLevelHead.config.levelFormat
        format = format.replace("%level%", level.toString())
        return ColorUtils.translateColorCodes(format)
    }

    private fun renderLevelText(text: String, x: Double, y: Double, z: Double) {
        val mc = Minecraft.getMinecraft()
        val fontRenderer = mc.fontRendererObj
        val scale = BedwarsLevelHead.config.textScale

        // Calculate position based on config
        val (renderX, renderY) = calculatePosition(x, y, z, text, fontRenderer, scale)

        // Render the level text
        fontRenderer.drawString(
            text,
            renderX.toFloat(),
            renderY.toFloat(),
            BedwarsLevelHead.config.textColor.rgb,
            true
        )
    }

    private fun calculatePosition(
        x: Double,
        y: Double,
        z: Double,
        text: String,
        fontRenderer: FontRenderer,
        scale: Float
    ): Pair<Double, Double> {
        val textWidth = fontRenderer.getStringWidth(text) * scale
        val textHeight = 8.0 * scale // Font height

        return when (BedwarsLevelHead.config.position) {
            0 -> Pair(x - textWidth / 2, y - textHeight - 2) // Above
            1 -> Pair(x - textWidth / 2, y + 2) // Below
            2 -> Pair(x + 2, y - textHeight / 2) // Right
            3 -> Pair(x - textWidth - 2, y - textHeight / 2) // Left
            else -> Pair(x - textWidth / 2, y - textHeight - 2) // Default above
        }
    }
}