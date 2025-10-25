package me.truffle.bedwarslevelhead.features

import net.minecraft.client.gui.FontRenderer

object NameTagRenderer {

    fun shouldRenderLevel(): Boolean {
        return BedwarsLevelHead.config.enabled
    }

    fun modifyNameTag(originalName: String, playerName: String): String {
        if (!shouldRenderLevel()) return originalName

        val levelData = LevelCache.getPlayerLevel(playerName) ?: return originalName
        val levelText = LevelDisplay.formatLevelText(levelData.level)

        return when (BedwarsLevelHead.config.position) {
            0 -> "$levelText\n$originalName" // Above
            1 -> "$originalName\n$levelText" // Below
            2 -> "$originalName $levelText"  // Right
            3 -> "$levelText $originalName"  // Left
            else -> "$levelText\n$originalName" // Default above
        }
    }
}