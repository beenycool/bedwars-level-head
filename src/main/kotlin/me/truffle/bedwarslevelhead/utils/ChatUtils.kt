package me.truffle.bedwarslevelhead.utils

import java.util.regex.Pattern

object ChatUtils {
    private val levelPatterns = listOf(
        Pattern.compile("\\[(\\d+)⭐?\\]"), // [100⭐]
        Pattern.compile("(\\d+)⭐"),        // 100⭐
        Pattern.compile("⭐(\\d+)")         // ⭐100
    )

    private val playerNamePattern = Pattern.compile("\\w{1,16}")

    fun extractLevelFromMessage(message: String): Int? {
        for (pattern in levelPatterns) {
            val matcher = pattern.matcher(message)
            if (matcher.find()) {
                return matcher.group(1).toIntOrNull()
            }
        }
        return null
    }

    fun extractPlayerNameFromMessage(message: String): String? {
        val matcher = playerNamePattern.matcher(message)
        if (matcher.find()) {
            return matcher.group()
        }
        return null
    }

    fun detectLevelFromChat(message: String) {
        val level = extractLevelFromMessage(message) ?: return
        val playerName = extractPlayerNameFromMessage(message) ?: return

        // Update cache
        me.truffle.bedwarslevelhead.data.LevelCache.updatePlayerLevel(playerName, level)
    }
}