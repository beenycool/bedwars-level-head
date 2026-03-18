package club.sk1er.mods.levelhead.duels

import club.sk1er.mods.levelhead.core.BaseStatsFetcher
import club.sk1er.mods.levelhead.core.GameMode
import com.google.gson.JsonObject

/**
 * Fetcher for Duels stats from Hypixel API or proxy.
 */
object DuelsFetcher : BaseStatsFetcher() {
    override val gameMode = GameMode.DUELS
    override val modeName = "Duels"

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
