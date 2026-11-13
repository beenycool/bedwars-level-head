package club.sk1er.mods.levelhead.duels

import com.google.gson.JsonObject
import java.awt.Color

/**
 * Utility object for calculating Duels divisions and stats.
 * Duels uses a division system based on wins rather than experience like BedWars.
 * Based on official Hypixel Duels division system and 25Karma implementation.
 */
object DuelsStats {
    data class DivisionRequirement(
        val req: Int,
        val step: Int,
        val max: Int,
        val name: String,
        val id: String,
        val color: Color,
        val colorCode: String,
        val bold: Boolean
    )

    data class OverallDivisionInfo(
        val displayName: String,
        val romanLevel: String,
        val color: Color,
        val colorCode: String,
        val bold: Boolean,
        val id: String
    )

    /**
     * Overall division thresholds for Duels based on total wins, using 25Karma's
     * "overall" requirements (the per-mode base requirements multiplied by 2).
     * Legend+ divisions are displayed in bold.
     */
    private val overallDivisions = listOf(
        DivisionRequirement(0, 0, 5, "None", "none", Color(170, 170, 170), "7", false),
        DivisionRequirement(100, 20, 5, "Rookie", "rookie", Color(170, 170, 170), "7", false),
        DivisionRequirement(200, 60, 5, "Iron", "iron", Color(255, 255, 255), "f", false),
        DivisionRequirement(500, 100, 5, "Gold", "gold", Color(255, 170, 0), "6", false),
        DivisionRequirement(1000, 200, 5, "Diamond", "diamond", Color(0, 170, 170), "3", false),
        DivisionRequirement(2000, 400, 5, "Master", "master", Color(0, 170, 0), "2", false),
        DivisionRequirement(4000, 1200, 5, "Legend", "legend", Color(170, 0, 0), "4", true),
        DivisionRequirement(10000, 2000, 5, "Grandmaster", "grandmaster", Color(255, 255, 85), "e", true),
        DivisionRequirement(20000, 6000, 5, "Godlike", "godlike", Color(170, 0, 170), "5", true),
        DivisionRequirement(50000, 10000, 5, "CELESTIAL", "celestial", Color(85, 255, 255), "b", true),
        DivisionRequirement(100000, 20000, 5, "DIVINE", "divine", Color(255, 85, 255), "d", true),
        DivisionRequirement(200000, 20000, 50, "ASCENDED", "ascended", Color(255, 85, 85), "c", true)
    )

    /**
     * Overall division display from total wins using 25Karma's "overall" requirements.
     * (base requirements multiplied by 2).
     */
    fun getOverallDivisionInfo(wins: Int): OverallDivisionInfo {
        var active = overallDivisions.first()
        for (i in overallDivisions.indices.reversed()) {
            if (wins >= overallDivisions[i].req) {
                active = overallDivisions[i]
                break
            }
        }

        if (active.id == "none") {
            return OverallDivisionInfo(
                displayName = "-",
                romanLevel = "-",
                color = active.color,
                colorCode = active.colorCode,
                bold = active.bold,
                id = active.id
            )
        }

        val level = if (active.step <= 0) {
            1
        } else {
            val remaining = wins - active.req
            (remaining / active.step) + 1
        }.coerceAtMost(active.max)

        val roman = romanize(level)
        val suffix = if (level > 1) " $roman" else ""
        return OverallDivisionInfo(
            displayName = "${active.name}$suffix",
            romanLevel = roman,
            color = active.color,
            colorCode = active.colorCode,
            bold = active.bold,
            id = active.id
        )
    }

    /**
     * Parse Duels wins from a player JSON response.
     */
    fun parseWins(json: JsonObject): Int? {
        val duels = findDuelsStats(json) ?: return null
        return duels.get("wins")?.takeIf { !it.isJsonNull }
            ?.let { runCatching { it.asInt }.getOrNull() }
    }

    /**
     * Parse Duels losses from a player JSON response.
     */
    fun parseLosses(json: JsonObject): Int? {
        val duels = findDuelsStats(json) ?: return null
        return duels.get("losses")?.takeIf { !it.isJsonNull }
            ?.let { runCatching { it.asInt }.getOrNull() }
    }

    /**
     * Parse Duels kills from a player JSON response.
     */
    fun parseKills(json: JsonObject): Int? {
        val duels = findDuelsStats(json) ?: return null
        return duels.get("kills")?.takeIf { !it.isJsonNull }
            ?.let { runCatching { it.asInt }.getOrNull() }
    }

    /**
     * Parse Duels deaths from a player JSON response.
     */
    fun parseDeaths(json: JsonObject): Int? {
        val duels = findDuelsStats(json) ?: return null
        return duels.get("deaths")?.takeIf { !it.isJsonNull }
            ?.let { runCatching { it.asInt }.getOrNull() }
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
     * Calculate Kill/Death Ratio.
     */
    fun calculateKDR(kills: Int?, deaths: Int?): Double? {
        if (kills == null || deaths == null) return null
        if (kills == 0 && deaths == 0) return null
        return if (deaths <= 0) kills.toDouble() else kills.toDouble() / deaths.toDouble()
    }

    /**
     * Find the Duels stats object from various JSON structures.
     */
    private fun findDuelsStats(json: JsonObject): JsonObject? {
        return club.sk1er.mods.levelhead.core.StatsPayloadParser.findStatsObject(json, club.sk1er.mods.levelhead.core.GameMode.DUELS)
    }

    fun symbolForDivisionId(id: String): String {
        return when (id) {
            "ascended" -> "⚔"
            "divine" -> "✺"
            "celestial" -> "✵"
            "godlike" -> "✯"
            "grandmaster" -> "★"
            "legend" -> "✫"
            "master" -> "✦"
            "diamond" -> "♦"
            "gold" -> "✹"
            "iron" -> "•"
            else -> "·"
        }
    }

    private fun romanize(value: Int): String {
        if (value <= 0) return "-"
        val numerals = arrayOf(
            1000 to "M",
            900 to "CM",
            500 to "D",
            400 to "CD",
            100 to "C",
            90 to "XC",
            50 to "L",
            40 to "XL",
            10 to "X",
            9 to "IX",
            5 to "V",
            4 to "IV",
            1 to "I"
        )
        var remaining = value
        val out = StringBuilder()
        numerals.forEach { (arabic, roman) ->
            while (remaining >= arabic) {
                out.append(roman)
                remaining -= arabic
            }
        }
        return out.toString()
    }
}
