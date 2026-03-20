package club.sk1er.mods.levelhead.duels

import club.sk1er.mods.levelhead.core.BaseStatsFetcher
import club.sk1er.mods.levelhead.core.GameMode
import club.sk1er.mods.levelhead.core.GameStats
import club.sk1er.mods.levelhead.core.StatsPayloadParser
import com.google.gson.JsonObject

/**
 * Fetcher for Duels stats from Hypixel API or proxy.
 */
object DuelsFetcher : BaseStatsFetcher() {
    override val gameMode = GameMode.DUELS
    override val modeName = "Duels"

    override fun buildStats(payload: JsonObject, etag: String?): GameStats? {
        StatsPayloadParser.findStatsObject(payload, GameMode.DUELS) ?: return null
        val nicked = StatsPayloadParser.isNicked(payload)
        val wins = DuelsStats.parseWins(payload)
        val losses = DuelsStats.parseLosses(payload)
        val kills = DuelsStats.parseKills(payload)
        val deaths = DuelsStats.parseDeaths(payload)
        val winstreak = DuelsStats.parseWinstreak(payload)
        val bestWinstreak = DuelsStats.parseBestWinstreak(payload)
        return GameStats.Duels(
            wins = wins, losses = losses, kills = kills, deaths = deaths,
            winstreak = winstreak, bestWinstreak = bestWinstreak,
            nicked = nicked, fetchedAt = System.currentTimeMillis(), etag = etag
        )
    }

    /**
     * Build CachedDuelsStats from a JSON response.
     */
    fun buildCachedStats(payload: JsonObject, etag: String? = null): CachedDuelsStats {
        val wins = DuelsStats.parseWins(payload)
        val losses = DuelsStats.parseLosses(payload)
        val kills = DuelsStats.parseKills(payload)
        val deaths = DuelsStats.parseDeaths(payload)
        val winstreak = DuelsStats.parseWinstreak(payload)
        val bestWinstreak = DuelsStats.parseBestWinstreak(payload)
        return CachedDuelsStats(
            wins = wins,
            losses = losses,
            kills = kills,
            deaths = deaths,
            winstreak = winstreak,
            bestWinstreak = bestWinstreak,
            fetchedAt = System.currentTimeMillis(),
            etag = etag
        )
    }
}
