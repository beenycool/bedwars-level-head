package club.sk1er.mods.levelhead.skywars

import club.sk1er.mods.levelhead.core.BaseStatsFetcher
import club.sk1er.mods.levelhead.core.GameMode
import com.google.gson.JsonObject

/**
 * Fetcher for SkyWars stats from Hypixel API or proxy.
 */
object SkyWarsFetcher : BaseStatsFetcher() {
    override val gameMode = GameMode.SKYWARS
    override val modeName = "SkyWars"

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
