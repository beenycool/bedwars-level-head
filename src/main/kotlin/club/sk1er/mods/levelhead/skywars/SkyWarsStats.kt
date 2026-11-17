package club.sk1er.mods.levelhead.skywars

import com.google.gson.JsonObject
import java.awt.Color

object SkyWarsStats {
    /**
     * XP requirements for each level (NOT cumulative - these get added together)
     * Based on official Hypixel/25Karma implementation
     *
     * To reach level n, you need sum of xpRequirements[0..n-1]
     */
    private val xpRequirements = longArrayOf(
        0,
        10,
        25,
        50,
        75,
        100,
        250,
        500,
        750,
        1000,
        1250,
        1500,
        1750,
        2000,
        2500,
        3000,
        3500,
        4000,
        4500
    )

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

    data class PrestigeStyle(
        val minLevel: Int,
        val color: Color
    )

    private val prestigeStyles = listOf(
        PrestigeStyle(0, Color(170, 170, 170)),
        PrestigeStyle(10, Color(255, 255, 255)),
        PrestigeStyle(20, Color(255, 170, 0)),
        PrestigeStyle(30, Color(85, 255, 255)),
        PrestigeStyle(40, Color(255, 85, 85)),
        PrestigeStyle(50, Color(255, 85, 255)),
        PrestigeStyle(60, Color(170, 0, 170)),
        PrestigeStyle(70, Color(85, 85, 255)),
        PrestigeStyle(80, Color(255, 255, 85)),
        PrestigeStyle(90, Color(85, 255, 85)),

        PrestigeStyle(100, Color(255, 85, 85)),
        PrestigeStyle(110, Color(255, 85, 85)),
        PrestigeStyle(120, Color(0, 0, 170)),
        PrestigeStyle(130, Color(255, 255, 255)),
        PrestigeStyle(140, Color(170, 0, 0)),
        PrestigeStyle(150, Color(255, 255, 85)),
        PrestigeStyle(160, Color(0, 170, 0)),
        PrestigeStyle(170, Color(85, 85, 255)),
        PrestigeStyle(180, Color(0, 170, 170)),
        PrestigeStyle(190, Color(255, 255, 85)),
        PrestigeStyle(200, Color(255, 255, 85)),
        PrestigeStyle(210, Color(255, 85, 255)),
        PrestigeStyle(220, Color(85, 85, 85)),
        PrestigeStyle(230, Color(85, 255, 255)),
        PrestigeStyle(240, Color(0, 0, 0)),
        PrestigeStyle(250, Color(255, 255, 85)),
        PrestigeStyle(260, Color(255, 170, 0)),
        PrestigeStyle(270, Color(0, 170, 170)),
        PrestigeStyle(280, Color(85, 255, 85)),
        PrestigeStyle(290, Color(85, 255, 255)),
        PrestigeStyle(300, Color(85, 255, 85)),
        PrestigeStyle(310, Color(85, 85, 85)),
        PrestigeStyle(320, Color(85, 255, 85)),
        PrestigeStyle(330, Color(255, 85, 85)),
        PrestigeStyle(340, Color(85, 255, 255)),
        PrestigeStyle(350, Color(255, 255, 85)),
        PrestigeStyle(360, Color(85, 255, 255)),
        PrestigeStyle(370, Color(255, 255, 255)),
        PrestigeStyle(380, Color(255, 85, 85)),
        PrestigeStyle(390, Color(85, 255, 85)),
        PrestigeStyle(400, Color(85, 255, 255)),
        PrestigeStyle(410, Color(0, 170, 170)),
        PrestigeStyle(420, Color(170, 0, 170)),
        PrestigeStyle(430, Color(255, 255, 255)),
        PrestigeStyle(440, Color(85, 255, 85)),
        PrestigeStyle(450, Color(255, 85, 85)),
        PrestigeStyle(460, Color(0, 170, 170)),
        PrestigeStyle(470, Color(255, 255, 255)),
        PrestigeStyle(480, Color(0, 170, 170)),
        PrestigeStyle(490, Color(255, 255, 255)),
        PrestigeStyle(500, Color(255, 85, 255))
    )

    data class EmblemMilestone(val minLevel: Int, val emblem: String)

    private val defaultEmblems = listOf(
        EmblemMilestone(0, "✯"),
        EmblemMilestone(50, "^_^"),
        EmblemMilestone(100, "@_@"),
        EmblemMilestone(150, "δvδ"),
        EmblemMilestone(200, "zz_zz"),
        EmblemMilestone(250, "■·■"),
        EmblemMilestone(300, "ಠ_ಠ"),
        EmblemMilestone(350, "o...0"),
        EmblemMilestone(400, ">u<"),
        EmblemMilestone(450, "v-v"),
        EmblemMilestone(500, "༼つ◕_◕༽つ")
    )

    fun calculateLevel(experience: Long): Double {
        if (experience <= 0) return 1.0

        val constantLevelingXP = cumulativeXP.last()

        if (experience >= constantLevelingXP) {
            val xpAboveConstant = experience - constantLevelingXP
            val level = (xpAboveConstant.toDouble() / XP_PER_LEVEL_AFTER_TABLE) + cumulativeXP.size
            return level.coerceAtMost(MAX_LEVEL.toDouble())
        }

        for (i in cumulativeXP.indices) {
            if (experience < cumulativeXP[i]) {
                val prevXP = if (i > 0) cumulativeXP[i - 1] else 0
                val progress = (experience - prevXP).toDouble() / (cumulativeXP[i] - prevXP).toDouble()
                return (i + progress).coerceAtLeast(1.0)
            }
        }

        return cumulativeXP.size.toDouble()
    }

    fun getPrestigeStyle(level: Int): PrestigeStyle {
        return prestigeStyles.lastOrNull { level >= it.minLevel } ?: prestigeStyles.first()
    }

    fun getDefaultEmblem(level: Int): String {
        return defaultEmblems.lastOrNull { level >= it.minLevel }?.emblem ?: "✯"
    }

    fun parseExperience(json: JsonObject): Long? {
        val skywars = findSkyWarsStats(json) ?: return null
        return skywars.get("skywars_experience")?.takeIf { !it.isJsonNull }
            ?.let { runCatching { it.asLong }.getOrNull() }
            ?: skywars.get("experience")?.takeIf { !it.isJsonNull }
                ?.let { runCatching { it.asLong }.getOrNull() }
            ?: skywars.get("Experience")?.takeIf { !it.isJsonNull }
                ?.let { runCatching { it.asLong }.getOrNull() }
    }

    fun parseWins(json: JsonObject): Int? {
        val skywars = findSkyWarsStats(json) ?: return null
        return skywars.get("wins")?.takeIf { !it.isJsonNull }
            ?.let { runCatching { it.asInt }.getOrNull() }
    }

    fun parseLosses(json: JsonObject): Int? {
        val skywars = findSkyWarsStats(json) ?: return null
        return skywars.get("losses")?.takeIf { !it.isJsonNull }
            ?.let { runCatching { it.asInt }.getOrNull() }
    }

    fun parseKills(json: JsonObject): Int? {
        val skywars = findSkyWarsStats(json) ?: return null
        return skywars.get("kills")?.takeIf { !it.isJsonNull }
            ?.let { runCatching { it.asInt }.getOrNull() }
    }

    fun parseDeaths(json: JsonObject): Int? {
        val skywars = findSkyWarsStats(json) ?: return null
        return skywars.get("deaths")?.takeIf { !it.isJsonNull }
            ?.let { runCatching { it.asInt }.getOrNull() }
    }

    fun calculateKDR(kills: Int?, deaths: Int?): Double? {
        if (kills == null || deaths == null) return null
        if (kills == 0 && deaths == 0) return null
        return if (deaths <= 0) kills.toDouble() else kills.toDouble() / deaths.toDouble()
    }

    fun calculateWLR(wins: Int?, losses: Int?): Double? {
        if (wins == null || losses == null) return null
        if (wins == 0 && losses == 0) return null
        return if (losses <= 0) wins.toDouble() else wins.toDouble() / losses.toDouble()
    }

    private fun findSkyWarsStats(json: JsonObject): JsonObject? {
        return club.sk1er.mods.levelhead.core.StatsPayloadParser.findStatsObject(json, club.sk1er.mods.levelhead.core.GameMode.SKYWARS)
    }
}
