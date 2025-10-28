package me.beeny.bedwarslevelhead.data

import me.beeny.bedwarslevelhead.BedwarsLevelHead
import me.beeny.bedwarslevelhead.utils.ColorUtils

data class PlayerLevelData(
    val playerName: String,
    val level: Int,
    val lastSeen: Long = System.currentTimeMillis()
) {
    fun getFormattedLevel(): String {
        val format = BedwarsLevelHead.config.levelFormat.replace("%level%", level.toString())
        return ColorUtils.translateColorCodes(format)
    }
}