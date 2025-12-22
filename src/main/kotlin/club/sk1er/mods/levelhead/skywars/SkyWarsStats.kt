package club.sk1er.mods.levelhead.skywars

import club.sk1er.mods.levelhead.bedwars.FetchResult
import com.google.gson.JsonObject
import java.awt.Color

/**
 * Utility object for calculating SkyWars levels and stats.
 * SkyWars uses an XP-based leveling system similar to BedWars.
 */
object SkyWarsStats {
    // XP thresholds for SkyWars levels (approximate based on Hypixel formulas)
    // SkyWars uses a prestige system with levels 1-60 per prestige, then prestige level increases
    private const val XP_PER_LEVEL_BASE = 10000L
    private const val LEVELS_PER_PRESTIGE = 60

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
     * Calculate the SkyWars level from experience.
     * Uses simplified formula based on Hypixel's level calculation.
     */
    fun calculateLevel(experience: Long): Int {
        if (experience <= 0L) return 1
        
        // SkyWars level calculation is roughly:
        // Each level requires base XP, with scaling
        // Simplified: level = sqrt(experience / 10000) + 1
        val level = (Math.sqrt(experience.toDouble() / XP_PER_LEVEL_BASE) + 1).toInt()
        return level.coerceAtLeast(1)
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
     */
    fun parseExperience(json: JsonObject): Long? {
        val skywars = findSkyWarsStats(json) ?: return null
        return skywars.entrySet()
            .firstOrNull { (key, _) ->
                key.equals("skywars_experience", ignoreCase = true) ||
                key.equals("experience", ignoreCase = true)
            }
            ?.value
            ?.takeIf { !it.isJsonNull }
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
