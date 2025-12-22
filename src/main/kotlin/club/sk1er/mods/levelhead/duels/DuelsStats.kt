package club.sk1er.mods.levelhead.duels

import com.google.gson.JsonObject
import java.awt.Color

/**
 * Utility object for calculating Duels divisions and stats.
 * Duels uses a division system based on wins rather than experience like BedWars.
 */
object DuelsStats {
    /**
     * Division thresholds for Duels based on overall wins.
     * Each division has a minimum wins requirement and a display name.
     * These thresholds are based on Hypixel's Duels division system.
     * 
     * Division progression (wins required):
     * - Rookie: 0
     * - Iron: 50
     * - Gold: 100
     * - Diamond: 250
     * - Master: 500
     * - Legend: 1,000
     * - Grandmaster: 2,000
     * - Godlike: 5,000
     * - Celestial: 10,000
     * - Divine: 25,000
     * - Ascended: 50,000
     */
    private val divisions = listOf(
        Division(minWins = 50, name = "Rookie", color = Color(170, 170, 170)),           // Gray
        Division(minWins = 100, name = "Iron", color = Color(255, 255, 255)),            // White
        Division(minWins = 250, name = "Gold", color = Color(255, 170, 0)),              // Gold
        Division(minWins = 500, name = "Diamond", color = Color(85, 255, 255)),          // Aqua
        Division(minWins = 1000, name = "Master", color = Color(0, 170, 0)),             // Green
        Division(minWins = 2000, name = "Legend", color = Color(170, 0, 0)),             // Dark Red
        Division(minWins = 5000, name = "Grandmaster", color = Color(255, 255, 85)),     // Yellow
        Division(minWins = 10000, name = "Godlike", color = Color(170, 0, 170)),         // Purple
        Division(minWins = 25000, name = "Celestial", color = Color(255, 85, 255)),      // Light Purple
        Division(minWins = 50000, name = "Divine", color = Color(85, 85, 255)),          // Blue
        Division(minWins = 100000, name = "Ascended", color = Color(255, 85, 85))        // Light Red
    )

    data class Division(val minWins: Int, val name: String, val color: Color)

    /**
     * Calculate the division for a given number of wins.
     */
    fun getDivision(wins: Int): Division {
        return divisions.lastOrNull { wins >= it.minWins } ?: divisions.first()
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
     * Parse current winstreak from a player JSON response.
     */
    fun parseWinstreak(json: JsonObject): Int? {
        val duels = findDuelsStats(json) ?: return null
        return duels.get("current_winstreak")?.takeIf { !it.isJsonNull }
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
        // Check for proxy response format: { data: { duels: {...} } }
        json.get("data")?.takeIf { it.isJsonObject }?.asJsonObject
            ?.get("duels")?.takeIf { it.isJsonObject }?.asJsonObject
            ?.let { return it }

        // Check for direct duels key
        json.get("duels")?.takeIf { it.isJsonObject }?.asJsonObject
            ?.let { return it }

        // Check for Hypixel API format: { player: { stats: { Duels: {...} } } }
        val playerContainer = when {
            json.get("player")?.isJsonObject == true -> json.getAsJsonObject("player")
            json.get("stats")?.isJsonObject == true -> json
            else -> null
        } ?: return null

        val stats = playerContainer.get("stats")?.takeIf { it.isJsonObject }?.asJsonObject ?: return null
        return stats.get("Duels")?.takeIf { it.isJsonObject }?.asJsonObject
    }

    /**
     * Style configuration for a division display.
     */
    data class DivisionStyle(val color: Color, val symbol: String)

    /**
     * Get the display style for a given division.
     */
    fun styleForDivision(wins: Int): DivisionStyle {
        val division = getDivision(wins)
        val symbol = when {
            wins >= 50000 -> "⚔"
            wins >= 10000 -> "✦"
            wins >= 2000 -> "★"
            else -> "✧"
        }
        return DivisionStyle(division.color, symbol)
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
