package club.sk1er.mods.levelhead.util

import me.beeny.bedwarslevelhead.utils.StarGlyphs
import java.util.regex.Pattern

/**
 * Enhanced utilities for detecting BedWars stars/levels in chat messages.
 * These patterns complement the existing API-based level detection.
 */
object ChatLevelDetector {
    
    /**
     * Common patterns for BedWars star display in chat.
     * Matches formats like: [100⭐], 100⭐, ⭐100, [100✫], etc.
     */
    private val STAR_ALTERNATION = StarGlyphs.alternation

    private val LEVEL_PATTERNS = listOf(
        Pattern.compile("\\[(\\d+)(?:$STAR_ALTERNATION)?\\]"),
        Pattern.compile("(\\d+)(?:$STAR_ALTERNATION)"),
        Pattern.compile("(?:$STAR_ALTERNATION)(\\d+)")
    )
    
    /**
     * Pattern for Minecraft player names (3-16 alphanumeric characters + underscores).
     * More restrictive than the PR version to avoid matching common words.
     */
    private val PLAYER_NAME_PATTERN = Pattern.compile("\\b([a-zA-Z0-9_]{3,16})\\b")
    
    /**
     * Attempts to extract a BedWars level/star from a chat message.
     * 
     * @param message The chat message to parse
     * @return The detected level, or null if no level pattern found
     */
    fun extractLevel(message: String): Int? {
        for (pattern in LEVEL_PATTERNS) {
            val matcher = pattern.matcher(message)
            if (matcher.find()) {
                return matcher.group(1).toIntOrNull()
            }
        }
        return null
    }
    
    /**
     * Attempts to extract a player name from a chat message.
     * Note: This is a best-effort heuristic and may return false positives.
     * Prefer using the actual player entity name when available.
     * 
     * @param message The chat message to parse
     * @return A potential player name, or null if none found
     */
    fun extractPlayerName(message: String): String? {
        val matcher = PLAYER_NAME_PATTERN.matcher(message)
        if (matcher.find()) {
            return matcher.group(1)
        }
        return null
    }
    
    /**
     * Checks if a message contains a BedWars level indicator.
     * Relies on numeric level + star patterns to avoid false positives from
     * standalone star characters.
     */
    fun containsLevelIndicator(message: String): Boolean {
        return LEVEL_PATTERNS.any { it.matcher(message).find() }
    }
}
