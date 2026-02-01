package club.sk1er.mods.levelhead.duels

import com.google.gson.JsonObject
import java.awt.Color

/**
 * Utility object for calculating Duels divisions and stats.
 * Duels uses a division system based on wins rather than experience like BedWars.
 * Based on official Hypixel Duels division system and 25Karma implementation.
 */
object DuelsStats {
    /**
     * Division thresholds for Duels based on overall wins.
     * Each division has a minimum wins requirement and a display name.
     * Legend+ divisions (2000+ wins) are displayed in bold.
     */
    data class Division(
        val minWins: Int,
        val name: String,
        val color: Color,
        val colorCode: String,
        val bold: Boolean = false
    )

    private val divisions = listOf(
        Division(100000, "ASCENDED", Color(255, 85, 85), "c", bold = true),
        Division(50000, "DIVINE", Color(255, 85, 255), "d", bold = true),
        Division(25000, "CELESTIAL", Color(85, 255, 255), "b", bold = true),
        Division(10000, "Godlike", Color(170, 0, 170), "5", bold = true),
        Division(5000, "Grandmaster", Color(255, 255, 85), "e", bold = true),
        Division(2000, "Legend", Color(170, 0, 0), "4", bold = true),
        Division(1000, "Master", Color(0, 170, 0), "2", bold = false),
        Division(500, "Diamond", Color(0, 170, 170), "3", bold = false),
        Division(250, "Gold", Color(255, 170, 0), "6", bold = false),
        Division(100, "Iron", Color(255, 255, 255), "f", bold = false),
        Division(50, "Rookie", Color(170, 170, 170), "7", bold = false),
        Division(0, "None", Color(170, 170, 170), "7", bold = false)
    )

    /**
     * Calculate the division for a given number of wins.
     */
    fun getDivision(wins: Int): Division = divisions.first { wins >= it.minWins }

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
     * Parse current winstreak from a player JSON response.
     */
    fun parseWinstreak(json: JsonObject): Int? {
        val duels = findDuelsStats(json) ?: return null
        return (duels.get("current_winstreak") ?: duels.get("winstreak"))?.takeIf { !it.isJsonNull }
            ?.let { runCatching { it.asInt }.getOrNull() }
    }

    /**
     * Parse best winstreak from a player JSON response.
     */
    fun parseBestWinstreak(json: JsonObject): Int? {
        val duels = findDuelsStats(json) ?: return null
        return duels.get("best_overall_winstreak")?.takeIf { !it.isJsonNull }
            ?.let { runCatching { it.asInt }.getOrNull() }
    }

    /**
     * Find the Duels stats object from various JSON structures.
     */
    private fun findDuelsStats(json: JsonObject): JsonObject? {
        return club.sk1er.mods.levelhead.core.StatsFetcher.findStatsObject(json, club.sk1er.mods.levelhead.core.GameMode.DUELS)
    }

    /**
     * Style configuration for a division display.
     */
    data class DivisionStyle(val color: Color, val colorCode: String, val bold: Boolean, val symbol: String)

    /**
     * Get the display style for a given division based on wins.
     */
    fun styleForDivision(wins: Int): DivisionStyle {
        val division = getDivision(wins)
        val symbol = when {
            wins >= 100000 -> "⚔"    // ⚔ ASCENDED
            wins >= 50000 -> "✺"     // ✺ DIVINE
            wins >= 25000 -> "✵"     // ✵ CELESTIAL
            wins >= 10000 -> "✯"     // ✯ Godlike
            wins >= 5000 -> "★"      // ★ Grandmaster
            wins >= 2000 -> "✫"      // ✫ Legend
            wins >= 1000 -> "✦"      // ✦ Master
            wins >= 500 -> "♦"       // ♦ Diamond
            wins >= 250 -> "✹"       // ✹ Gold
            wins >= 100 -> "•"       // • Iron
            else -> "·"               // · Rookie/None
        }
        return DivisionStyle(division.color, division.colorCode, division.bold, symbol)
    }

    /**
     * Format a Duels division for display.
     * Returns format: [Division Symbol] for non-bold or §l[Division Symbol] for bold divisions.
     * Example: §4§l[Legend ✫] for Legend division
     */
    fun formatDivisionTag(wins: Int): String {
        val division = getDivision(wins)
        val style = styleForDivision(wins)
        val boldFormat = if (division.bold) "§l" else ""
        return "§${division.colorCode}$boldFormat[${division.name} ${style.symbol}]"
    }
}

/**
 * Cached Duels stats for a player.
 */
data class CachedDuelsStats(
    val wins: Int?,
    val losses: Int?,
    val kills: Int?,
    val deaths: Int?,
    val winstreak: Int?,
    val bestWinstreak: Int?,
    val fetchedAt: Long,
    val etag: String? = null
) {
    val wlr: Double? get() = DuelsStats.calculateWLR(wins, losses)
    val kdr: Double? get() = DuelsStats.calculateKDR(kills, deaths)
    val division: DuelsStats.Division? get() = wins?.let { DuelsStats.getDivision(it) }

    fun isExpired(ttlMillis: Long, now: Long = System.currentTimeMillis()): Boolean {
        return now - fetchedAt >= ttlMillis
    }
}
