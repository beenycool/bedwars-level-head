package me.beeny.bedwarslevelhead.features

import me.beeny.bedwarslevelhead.BedwarsLevelHead
import me.beeny.bedwarslevelhead.data.LevelCache
import net.minecraft.client.gui.FontRenderer

object NameTagRenderer {

    private const val POSITION_ABOVE = 0
    private const val POSITION_BELOW = 1
    private const val POSITION_RIGHT = 2
    private const val POSITION_LEFT = 3

    fun shouldRenderLevel(): Boolean {
        return BedwarsLevelHead.config.modEnabled
    }

    fun modifyNameTag(originalName: String, playerName: String): String {
        if (!shouldRenderLevel()) return originalName

        val levelData = LevelCache.getPlayerLevel(playerName) ?: return originalName
        val levelText = LevelDisplay.formatLevelText(levelData.level)

        return when (BedwarsLevelHead.config.position) {
            POSITION_ABOVE -> "$levelText $originalName" // Above (inline for tab list compatibility)
            POSITION_BELOW -> "$originalName $levelText" // Below (inline for tab list compatibility)
            POSITION_RIGHT -> "$originalName $levelText"  // Right
            POSITION_LEFT -> "$levelText $originalName"  // Left
            else -> "$levelText $originalName" // Default above (inline)
        }
    }
}
