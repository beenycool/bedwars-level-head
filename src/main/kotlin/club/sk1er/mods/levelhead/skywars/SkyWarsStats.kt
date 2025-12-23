package club.sk1er.mods.levelhead.skywars

import com.google.gson.JsonObject
import java.awt.Color

/**
 * Utility object for calculating SkyWars levels and stats.
 * SkyWars uses an XP-based leveling system with prestiges every 10 levels.
 * Based on official Hypixel API structure and 25Karma implementation.
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
     * Official Hypixel SkyWars prestige tiers.
     * Each prestige tier unlocks every 10 levels.
     */
    data class PrestigeStyle(
        val id: String,
        val name: String,
        val minLevel: Int,
        val color: Color,
        val colorCode: String
    )

    private val prestigeStyles = listOf(
        PrestigeStyle("stone_prestige", "Stone", 0, Color(170, 170, 170), "7"),
        PrestigeStyle("iron_prestige", "Iron", 10, Color(255, 255, 255), "f"),
        PrestigeStyle("gold_prestige", "Gold", 20, Color(255, 170, 0), "6"),
        PrestigeStyle("diamond_prestige", "Diamond", 30, Color(85, 255, 255), "b"),
        PrestigeStyle("ruby_prestige", "Ruby", 40, Color(255, 85, 85), "c"),
        PrestigeStyle("crystal_prestige", "Crystal", 50, Color(255, 85, 255), "d"),
        PrestigeStyle("amethyst_prestige", "Amethyst", 60, Color(170, 0, 170), "5"),
        PrestigeStyle("opal_prestige", "Opal", 70, Color(85, 85, 255), "9"),
        PrestigeStyle("topaz_prestige", "Topaz", 80, Color(255, 255, 85), "e"),
        PrestigeStyle("jade_prestige", "Jade", 90, Color(85, 255, 85), "a"),
        PrestigeStyle("mythic_i_prestige", "Mythic", 100, Color(255, 85, 85), "c")
    )

    /**
     * Default emblems that appear at specific level milestones.
     * Players can customize these, but these are the defaults shown.
     */
    data class EmblemMilestone(val minLevel: Int, val emblem: String, val name: String)

    private val defaultEmblems = listOf(
        EmblemMilestone(0, "✯", "default"),
        EmblemMilestone(50, "^_^", "carrots_for_eyes"),
        EmblemMilestone(100, "@_@", "formerly_known"),
        EmblemMilestone(150, "δvδ", "reflex_angle_eyebrows"),
        EmblemMilestone(200, "zz_zz", "two_tired"),
        EmblemMilestone(250, "■·■", "slime"),
        EmblemMilestone(300, "ಠ_ಠ", "same_great_taste"),
        EmblemMilestone(350, "o...0", "misaligned"),
        EmblemMilestone(400, ">u<", "converge_on_tongue"),
        EmblemMilestone(450, "v-v", "no_evil"),
        EmblemMilestone(500, "༼つ◕_◕༽つ", "three_fourths_jam")
    )

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
     * Returns the highest prestige tier the player has unlocked.
     */
    fun getPrestigeStyle(level: Int): PrestigeStyle {
        return prestigeStyles.lastOrNull { level >= it.minLevel } ?: prestigeStyles.first()
    }

    /**
     * Get the default emblem for a given level.
     * Returns the highest emblem milestone the player has reached.
     */
    fun getDefaultEmblem(level: Int): String {
        return defaultEmblems.lastOrNull { level >= it.minLevel }?.emblem ?: "✯"
    }

    /**
     * Parse SkyWars experience from a player JSON response.
     * Looks for 'skywars_experience' (preferred) or 'experience' within the SkyWars stats object.
     */
    fun parseExperience(json: JsonObject): Long? {
        val skywars = findSkyWarsStats(json) ?: return null
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
     * Format a SkyWars level for display with appropriate prestige color and emblem.
     * Returns format: [Level{Emblem}]
     * Example: §c[100@_@] for Mythic prestige at level 100
     */
    fun formatLevelTag(level: Int): String {
        val style = getPrestigeStyle(level)
        val emblem = getDefaultEmblem(level)
        return "§${style.colorCode}[$level$emblem]"
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
