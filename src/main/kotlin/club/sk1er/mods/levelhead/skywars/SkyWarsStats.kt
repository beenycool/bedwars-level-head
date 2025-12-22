package club.sk1er.mods.levelhead.skywars

import com.google.gson.JsonObject
import java.awt.Color

/**
 * Utility object for calculating SkyWars levels and stats.
 * SkyWars uses an XP-based leveling system similar to BedWars.
 */
object SkyWarsStats {
    private val xpTable = longArrayOf(
        0,    // Level 1
        20,   // Level 2
        70,   // Level 3
        150,  // Level 4
        250,  // Level 5
        500,  // Level 6
        1000, // Level 7
        2000, // Level 8
        3500, // Level 9
        6000, // Level 10
        10000,// Level 11
        15000 // Level 12
    )

    private const val XP_PER_LEVEL_AFTER_TABLE = 10000L

    /**
     * Prestige colors for SkyWars based on level brackets.
     */
    private val prestigeStyles = listOf(
        PrestigeStyle(0, Color(170, 170, 170), "7"),      // 0-59: None (Gray)
        PrestigeStyle(60, Color(255, 255, 255), "f"),     // 60-119: Iron (White)
        PrestigeStyle(120, Color(255, 170, 0), "6"),      // 120-179: Gold
        PrestigeStyle(180, Color(85, 255, 255), "b"),     // 180-239: Diamond (Aqua)
        PrestigeStyle(240, Color(0, 170, 0), "2"),        // 240-299: Emerald (Dark Green)
        PrestigeStyle(300, Color(0, 170, 170), "3"),      // 300-359: Sapphire (Dark Aqua)
        PrestigeStyle(360, Color(170, 0, 0), "4"),        // 360-419: Ruby (Dark Red)
        PrestigeStyle(420, Color(255, 85, 255), "d"),     // 420-479: Crystal (Light Purple)
        PrestigeStyle(480, Color(85, 85, 255), "9"),      // 480-539: Opal (Blue)
        PrestigeStyle(540, Color(170, 0, 170), "5"),      // 540-599: Amethyst (Dark Purple)
        PrestigeStyle(600, Color(255, 85, 85), "c")       // 600+: Mythic (Red)
    )

    data class PrestigeStyle(val minLevel: Int, val color: Color, val colorCode: String)

    /**
     * Calculate the SkyWars level from experience using the official piecewise progression.
     */
    fun calculateLevel(experience: Long): Int {
        if (experience <= 0L) return 1

        // Levels 1-12 use the XP table; afterwards, every level costs 10k XP
        for (i in 0 until xpTable.lastIndex) {
            val current = xpTable[i]
            val next = xpTable[i + 1]
            if (experience < next) {
                val progress = (experience - current).toDouble() / (next - current).toDouble()
                return (i + 1 + progress).toInt().coerceAtLeast(1)
            }
        }

        val extraXp = experience - xpTable.last()
        val additionalLevels = (extraXp / XP_PER_LEVEL_AFTER_TABLE).toInt()
        return 12 + additionalLevels
    }

    /**
     * Get prestige style for a given level.
     */
    fun getPrestigeStyle(level: Int): PrestigeStyle {
        return prestigeStyles.lastOrNull { level >= it.minLevel } ?: prestigeStyles.first()
    }

    /**
     * Get the star symbol for display based on level.
     */
    fun getStarSymbol(level: Int): String {
        return when {
            level >= 600 -> "✰"
            level >= 300 -> "✪"
            else -> "⋆"
        }
    }

    /**
     * Parse SkyWars experience from a player JSON response.
     * Looks for 'skywars_experience' (preferred) or 'experience' within the SkyWars stats object.
     * Note: 'experience' is searched within the SkyWars stats context, not the root JSON.
     */
    fun parseExperience(json: JsonObject): Long? {
        val skywars = findSkyWarsStats(json) ?: return null
        // Prefer specific 'skywars_experience' key, fall back to 'experience'
        return skywars.get("skywars_experience")?.takeIf { !it.isJsonNull }
            ?.let { runCatching { it.asLong }.getOrNull() }
            ?: skywars.get("experience")?.takeIf { !it.isJsonNull }
                ?.let { runCatching { it.asLong }.getOrNull() }
    }

    /**
     * Parse SkyWars wins from a player JSON response.
     */
    fun parseWins(json: JsonObject): Int? {
        val skywars = findSkyWarsStats(json) ?: return null
        return skywars.get("wins")?.takeIf { !it.isJsonNull }
            ?.let { runCatching { it.asInt }.getOrNull() }
    }

    /**
     * Parse SkyWars losses from a player JSON response.
     */
    fun parseLosses(json: JsonObject): Int? {
        val skywars = findSkyWarsStats(json) ?: return null
        return skywars.get("losses")?.takeIf { !it.isJsonNull }
            ?.let { runCatching { it.asInt }.getOrNull() }
    }

    /**
     * Parse SkyWars kills from a player JSON response.
     */
    fun parseKills(json: JsonObject): Int? {
        val skywars = findSkyWarsStats(json) ?: return null
        return skywars.get("kills")?.takeIf { !it.isJsonNull }
            ?.let { runCatching { it.asInt }.getOrNull() }
    }

    /**
     * Parse SkyWars deaths from a player JSON response.
     */
    fun parseDeaths(json: JsonObject): Int? {
        val skywars = findSkyWarsStats(json) ?: return null
        return skywars.get("deaths")?.takeIf { !it.isJsonNull }
            ?.let { runCatching { it.asInt }.getOrNull() }
    }

    /**
     * Calculate Kill/Death Ratio.
     */
    fun calculateKDR(kills: Int?, deaths: Int?): Double? {
        if (kills == null || deaths == null) return null
        if (kills == 0 && deaths == 0) return null
        return if (deaths <= 0) kills.toDouble() else kills.toDouble() / deaths.toDouble()
    }

    /**
     * Calculate Win/Loss Ratio.
     */
    fun calculateWLR(wins: Int?, losses: Int?): Double? {
        if (wins == null || losses == null) return null
        if (wins == 0 && losses == 0) return null
        return if (losses <= 0) wins.toDouble() else wins.toDouble() / losses.toDouble()
    }

    /**
     * Find the SkyWars stats object from various JSON structures.
     */
    private fun findSkyWarsStats(json: JsonObject): JsonObject? {
        // Check for proxy response format: { data: { skywars: {...} } }
        json.get("data")?.takeIf { it.isJsonObject }?.asJsonObject
            ?.get("skywars")?.takeIf { it.isJsonObject }?.asJsonObject
            ?.let { return it }

        // Check for direct skywars key
        json.get("skywars")?.takeIf { it.isJsonObject }?.asJsonObject
            ?.let { return it }

        // Check for Hypixel API format: { player: { stats: { SkyWars: {...} } } }
        val playerContainer = when {
            json.get("player")?.isJsonObject == true -> json.getAsJsonObject("player")
            json.get("stats")?.isJsonObject == true -> json
            else -> null
        } ?: return null

        val stats = playerContainer.get("stats")?.takeIf { it.isJsonObject }?.asJsonObject ?: return null
        return stats.get("SkyWars")?.takeIf { it.isJsonObject }?.asJsonObject
    }

    /**
     * Format a SkyWars level for display with appropriate color.
     */
    fun formatLevelTag(level: Int): String {
        val style = getPrestigeStyle(level)
        val symbol = getStarSymbol(level)
        return "§${style.colorCode}[$level$symbol]"
    }
}

/**
 * Cached SkyWars stats for a player.
 */
data class CachedSkyWarsStats(
    val level: Int?,
    val experience: Long?,
    val wins: Int?,
    val losses: Int?,
    val kills: Int?,
    val deaths: Int?,
    val fetchedAt: Long,
    val etag: String? = null
) {
    val kdr: Double? get() = SkyWarsStats.calculateKDR(kills, deaths)
    val wlr: Double? get() = SkyWarsStats.calculateWLR(wins, losses)
    val prestigeStyle: SkyWarsStats.PrestigeStyle? 
        get() = level?.let { SkyWarsStats.getPrestigeStyle(it) }

    fun isExpired(ttlMillis: Long, now: Long = System.currentTimeMillis()): Boolean {
        return now - fetchedAt >= ttlMillis
    }
}
