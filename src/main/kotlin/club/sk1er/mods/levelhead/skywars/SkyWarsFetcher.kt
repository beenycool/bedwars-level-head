package club.sk1er.mods.levelhead.skywars

import club.sk1er.mods.levelhead.core.BaseStatsFetcher
import club.sk1er.mods.levelhead.core.GameMode
import club.sk1er.mods.levelhead.core.GameStats
import club.sk1er.mods.levelhead.core.StatsPayloadParser
import com.google.gson.JsonObject

/**
 * Fetcher for SkyWars stats from Hypixel API or proxy.
 */
object SkyWarsFetcher : BaseStatsFetcher() {
    override val gameMode = GameMode.SKYWARS
    override val modeName = "SkyWars"

    override fun buildStats(payload: JsonObject, etag: String?): GameStats? {
        StatsPayloadParser.findStatsObject(payload, GameMode.SKYWARS) ?: return null
        val nicked = StatsPayloadParser.isNicked(payload)
        val experience = SkyWarsStats.parseExperience(payload)
        val level = experience?.let { SkyWarsStats.calculateLevel(it) }
        val wins = SkyWarsStats.parseWins(payload)
        val losses = SkyWarsStats.parseLosses(payload)
        val kills = SkyWarsStats.parseKills(payload)
        val deaths = SkyWarsStats.parseDeaths(payload)
        return GameStats.SkyWars(
            level = level, experience = experience, wins = wins, losses = losses,
            kills = kills, deaths = deaths,
            nicked = nicked, fetchedAt = System.currentTimeMillis(), etag = etag
        )
    }

    /**
     * Build CachedSkyWarsStats from a JSON response.
     */
    fun buildCachedStats(payload: JsonObject, etag: String? = null): CachedSkyWarsStats {
        val experience = SkyWarsStats.parseExperience(payload)
        val level = experience?.let { SkyWarsStats.calculateLevel(it) }
        val wins = SkyWarsStats.parseWins(payload)
        val losses = SkyWarsStats.parseLosses(payload)
        val kills = SkyWarsStats.parseKills(payload)
        val deaths = SkyWarsStats.parseDeaths(payload)
        return CachedSkyWarsStats(
            level = level,
            experience = experience,
            wins = wins,
            losses = losses,
            kills = kills,
            deaths = deaths,
            fetchedAt = System.currentTimeMillis(),
            etag = etag
        )
    }
}
