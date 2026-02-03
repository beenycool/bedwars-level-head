package club.sk1er.mods.levelhead.skywars

import com.google.gson.JsonObject
import java.awt.Color

/**
 * Utility object for calculating SkyWars levels and stats.
 * SkyWars uses an XP-based leveling system with prestiges every 10 levels.
 * Based on official Hypixel API structure and 25Karma implementation.
 */
object SkyWarsStats {
    /**
     * XP requirements for each level (NOT cumulative - these get added together)
     * Based on official Hypixel/25Karma implementation
     * 
     * To reach level n, you need sum of xpRequirements[0..n-1]
     */
    private val xpRequirements = longArrayOf(
        0,      // Level 1 (0 XP needed)
        10,     // Level 2 (need 10 XP from level 1)
        25,     // Level 3 (need 25 XP from level 2)
        50,     // Level 4 (need 50 XP from level 3)
        75,     // Level 5 (need 75 XP from level 4)
        100,    // Level 6 (need 100 XP from level 5)
        250,    // Level 7 (need 250 XP from level 6)
        500,    // Level 8 (need 500 XP from level 7)
        750,    // Level 9 (need 750 XP from level 8)
        1000,   // Level 10 (need 1000 XP from level 9)
        1250,   // Level 11 (need 1250 XP from level 10)
        1500,   // Level 12 (need 1500 XP from level 11)
        1750,   // Level 13 (need 1750 XP from level 12)
        2000,   // Level 14 (need 2000 XP from level 13)
        2500,   // Level 15 (need 2500 XP from level 14)
        3000,   // Level 16 (need 3000 XP from level 15)
        3500,   // Level 17 (need 3500 XP from level 16)
        4000,   // Level 18 (need 4000 XP from level 17)
        4500    // Level 19 (need 4500 XP from level 18)
    )

    /**
     * Cumulative XP table - calculated by summing xpRequirements
     * cumulativeXP[i] = total XP needed to reach level (i+1)
     */
    private val cumulativeXP: LongArray by lazy {
        val result = LongArray(xpRequirements.size)
        var sum = 0L
        for (i in xpRequirements.indices) {
            sum += xpRequirements[i]
            result[i] = sum
        }
        result
    }

    private const val XP_PER_LEVEL_AFTER_TABLE = 5000L
    private const val MAX_LEVEL = 10000

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

    /**
     * All 51 prestige tiers from 25Karma implementation.
     * Each prestige unlocks every 10 levels with unique colors.
     */
    private val prestigeStyles = listOf(
        // Base prestiges (0-90)
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
        
        // Mythic tiers (100-500)
        PrestigeStyle("mythic_i_prestige", "Mythic", 100, Color(255, 85, 85), "c"),
        PrestigeStyle("bloody_prestige", "Bloody", 110, Color(255, 85, 85), "c"),
        PrestigeStyle("cobalt_prestige", "Cobalt", 120, Color(0, 0, 170), "1"),
        PrestigeStyle("content_prestige", "Content", 130, Color(255, 255, 255), "f"),
        PrestigeStyle("crimson_prestige", "Crimson", 140, Color(170, 0, 0), "4"),
        PrestigeStyle("firefly_prestige", "Firefly", 150, Color(255, 255, 85), "e"),
        PrestigeStyle("emerald_prestige", "Emerald", 160, Color(0, 170, 0), "2"),
        PrestigeStyle("abyss_prestige", "Abyss", 170, Color(85, 85, 255), "9"),
        PrestigeStyle("sapphire_prestige", "Sapphire", 180, Color(0, 170, 170), "3"),
        PrestigeStyle("emergency_prestige", "Emergency", 190, Color(255, 255, 85), "e"),
        PrestigeStyle("mythic_ii_prestige", "Mythic II", 200, Color(255, 255, 85), "e"),
        PrestigeStyle("mulberry_prestige", "Mulberry", 210, Color(255, 85, 255), "d"),
        PrestigeStyle("slate_prestige", "Slate", 220, Color(85, 85, 85), "8"),
        PrestigeStyle("blood_god_prestige", "Blood God", 230, Color(85, 255, 255), "b"),
        PrestigeStyle("midnight_prestige", "Midnight", 240, Color(0, 0, 0), "0"),
        PrestigeStyle("sun_prestige", "Sun", 250, Color(255, 255, 85), "e"),
        PrestigeStyle("bulb_prestige", "Bulb", 260, Color(255, 170, 0), "6"),
        PrestigeStyle("twilight_prestige", "Twilight", 270, Color(0, 170, 170), "3"),
        PrestigeStyle("natural_prestige", "Natural", 280, Color(85, 255, 85), "a"),
        PrestigeStyle("icile_prestige", "Icicle", 290, Color(85, 255, 255), "b"),
        PrestigeStyle("mythic_iii_prestige", "Mythic III", 300, Color(85, 255, 85), "a"),
        PrestigeStyle("graphite_prestige", "Graphite", 310, Color(85, 85, 85), "8"),
        PrestigeStyle("punk_prestige", "Punk", 320, Color(85, 255, 85), "a"),
        PrestigeStyle("meltdown_prestige", "Meltdown", 330, Color(255, 85, 85), "c"),
        PrestigeStyle("iridescent_prestige", "Iridescent", 340, Color(85, 255, 255), "b"),
        PrestigeStyle("marigold_prestige", "Marigold", 350, Color(255, 255, 85), "e"),
        PrestigeStyle("beach_prestige", "Beach", 360, Color(85, 255, 255), "b"),
        PrestigeStyle("spark_prestige", "Spark", 370, Color(255, 255, 255), "f"),
        PrestigeStyle("target_prestige", "Target", 380, Color(255, 85, 85), "c"),
        PrestigeStyle("limelight_prestige", "Limelight", 390, Color(85, 255, 85), "a"),
        PrestigeStyle("mythic_iv_prestige", "Mythic IV", 400, Color(85, 255, 255), "b"),
        PrestigeStyle("cerulean_prestige", "Cerulean", 410, Color(0, 170, 170), "3"),
        PrestigeStyle("magical_prestige", "Magical", 420, Color(170, 0, 170), "5"),
        PrestigeStyle("luminous_prestige", "Luminous", 430, Color(255, 255, 255), "f"),
        PrestigeStyle("synthesis_prestige", "Synthesis", 440, Color(85, 255, 85), "a"),
        PrestigeStyle("burn_prestige", "Burn", 450, Color(255, 85, 85), "c"),
        PrestigeStyle("dramatic_prestige", "Dramatic", 460, Color(0, 170, 170), "3"),
        PrestigeStyle("radiant_prestige", "Radiant", 470, Color(255, 255, 255), "f"),
        PrestigeStyle("tidal_prestige", "Tidal", 480, Color(0, 170, 170), "3"),
        PrestigeStyle("firework_prestige", "Firework", 490, Color(255, 255, 255), "f"),
        PrestigeStyle("mythic_v_prestige", "Mythic V", 500, Color(255, 85, 255), "d")
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
     * Calculate the SkyWars level from experience using the official 25Karma/Hypixel algorithm.
     * 
     * Levels 1-19: Use cumulative XP requirements
     * Levels 20+: Each level requires 5,000 XP
     * Max level: 10,000
     * 
     * Returns Double for precision, but display uses integer (floor).
     */
    fun calculateLevel(experience: Long): Double {
        if (experience <= 0) return 1.0
        
        val constantLevelingXP = cumulativeXP.last()
        
        // Levels 20+ use recurring XP (5,000 per level)
        if (experience >= constantLevelingXP) {
            val xpAboveConstant = experience - constantLevelingXP
            val level = (xpAboveConstant.toDouble() / XP_PER_LEVEL_AFTER_TABLE) + cumulativeXP.size
            return level.coerceAtMost(MAX_LEVEL.toDouble())
        }
        
        // Levels 1-19 use cumulative XP table
        for (i in cumulativeXP.indices) {
            if (experience < cumulativeXP[i]) {
                val prevXP = if (i > 0) cumulativeXP[i - 1] else 0
                val progress = (experience - prevXP).toDouble() / (cumulativeXP[i] - prevXP).toDouble()
                return (i + progress).coerceAtLeast(1.0)
            }
        }
        
        // If we've reached here, the experience exactly matches the last cumulative value
        return cumulativeXP.size.toDouble()
    }

    /**
     * Get prestige style for a given level.
     * Returns the highest prestige tier the player has unlocked.
     */
    fun getPrestigeStyle(level: Int): PrestigeStyle {
        return prestigeStyles.lastOrNull { level >= it.minLevel } ?: prestigeStyles.first()
    }

    /**
     * Get prestige style for a given level (Double version).
     * Uses floor of the level for prestige calculation.
     */
    fun getPrestigeStyle(level: Double): PrestigeStyle {
        return getPrestigeStyle(level.toInt())
    }

    /**
     * Get the default emblem for a given level.
     * Returns the highest emblem milestone the player has reached.
     */
    fun getDefaultEmblem(level: Int): String {
        return defaultEmblems.lastOrNull { level >= it.minLevel }?.emblem ?: "✯"
    }

    /**
     * Get the default emblem for a given level (Double version).
     * Uses floor of the level for emblem calculation.
     */
    fun getDefaultEmblem(level: Double): String {
        return getDefaultEmblem(level.toInt())
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
            ?: skywars.get("Experience")?.takeIf { !it.isJsonNull }
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
        return club.sk1er.mods.levelhead.core.StatsFetcher.findStatsObject(json, club.sk1er.mods.levelhead.core.GameMode.SKYWARS)
    }

    /**
     * Format a SkyWars level for display with appropriate prestige color and emblem.
     * Returns format: [Level{Emblem}]
     * Example: §c[100@_@] for Mythic prestige at level 100
     * 
     * Uses floor of the level for display (integer only).
     */
    fun formatLevelTag(level: Int): String {
        val style = getPrestigeStyle(level)
        val emblem = getDefaultEmblem(level)
        return "§${style.colorCode}[$level$emblem]"
    }

    /**
     * Format a SkyWars level for display (Double version).
     * Uses floor of the level for display (integer only).
     * Example: §c[100@_@] for Mythic prestige at level 100.5
     */
    fun formatLevelTag(level: Double): String {
        return formatLevelTag(level.toInt())
    }
}

/**
 * Cached SkyWars stats for a player.
 */
data class CachedSkyWarsStats(
    val level: Double?,
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

    /**
     * Integer version of level for display purposes.
     * Uses floor of the decimal level.
     */
    val levelInt: Int get() = level?.toInt() ?: 0

    fun isExpired(ttlMillis: Long, now: Long = System.currentTimeMillis()): Boolean {
        return now - fetchedAt >= ttlMillis
    }
}
