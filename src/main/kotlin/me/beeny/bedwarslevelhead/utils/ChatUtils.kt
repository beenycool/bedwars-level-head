package me.beeny.bedwarslevelhead.utils

import java.util.regex.Pattern

object ChatUtils {
    private val starAlternation = StarGlyphs.alternation
    private val levelPatterns = listOf(
        Pattern.compile("\\[(\\d+)(?:$starAlternation)?\\]"),
        Pattern.compile("(\\d+)(?:$starAlternation)"),
        Pattern.compile("(?:$starAlternation)(\\d+)")
    )

    // Match a Minecraft-like username with hard boundaries; we additionally enforce at least one letter at runtime
    private val playerNamePattern = Pattern.compile("(?<![A-Za-z0-9_])([A-Za-z0-9_]{3,16})(?![A-Za-z0-9_])")

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
        // First try to find level pattern and extract name near it
        for (levelPattern in levelPatterns) {
            val levelMatcher = levelPattern.matcher(message)
            if (levelMatcher.find()) {
                val levelStart = levelMatcher.start()
                // Search for a bounded player name before the level within the same message region
                val nameMatcher = playerNamePattern.matcher(message)
                nameMatcher.region(0, levelStart)

                var lastValidName: String? = null
                var lastValidEnd = -1
                while (nameMatcher.find()) {
                    val candidate = nameMatcher.group(1)
                    // Enforce at least one letter to avoid pure-number false positives
                    if (candidate.any { it.isLetter() }) {
                        lastValidName = candidate
                        lastValidEnd = nameMatcher.end(1)
                    }
                }
                if (lastValidName != null) {
                    // Prefer names that are immediately followed by a delimiter like ':' to reduce false positives
                    if (lastValidEnd in 0 until message.length) {
                        val nextChar = message[lastValidEnd]
                        if (nextChar == ':' || nextChar == ' ' || nextChar == '\t') {
                            return lastValidName
                        }
                    }
                    return lastValidName
                }
            }
        }

        // Fallback: accept a bounded player name only when followed by a delimiter like ':'
        val matcher = playerNamePattern.matcher(message)
        while (matcher.find()) {
            val candidate = matcher.group(1)
            if (!candidate.any { it.isLetter() }) continue
            val endIdx = matcher.end(1)
            if (endIdx < message.length) {
                val nextChar = message[endIdx]
                if (nextChar == ':') {
                    return candidate
                }
            }
        }
        return null
    }

    fun detectLevelFromChat(message: String) {
        val level = extractLevelFromMessage(message) ?: return
        val playerName = extractPlayerNameFromMessage(message) ?: return

        // Update cache
        me.beeny.bedwarslevelhead.data.LevelCache.updatePlayerLevel(playerName, level)
    }
}
