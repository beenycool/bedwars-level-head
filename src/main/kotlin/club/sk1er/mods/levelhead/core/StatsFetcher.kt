package club.sk1er.mods.levelhead.core

import club.sk1er.mods.levelhead.bedwars.BedwarsFetcher
import club.sk1er.mods.levelhead.bedwars.FetchResult
import club.sk1er.mods.levelhead.duels.DuelsFetcher
import club.sk1er.mods.levelhead.duels.DuelsStats
import club.sk1er.mods.levelhead.skywars.SkyWarsFetcher
import club.sk1er.mods.levelhead.skywars.SkyWarsStats
import com.google.gson.JsonObject
import java.util.UUID

/**
 * Routes stat fetching requests to the appropriate game mode fetcher.
 * Provides a unified interface for fetching stats regardless of game mode.
 */
object StatsFetcher {
    
    /**
     * Fetch stats for a player in the specified game mode.
     */
    suspend fun fetchPlayer(
        uuid: UUID,
        gameMode: GameMode,
        lastFetchedAt: Long? = null,
        etag: String? = null
    ): FetchResult {
        return when (gameMode) {
            GameMode.BEDWARS -> BedwarsFetcher.fetchPlayer(uuid, lastFetchedAt, etag)
            GameMode.DUELS -> DuelsFetcher.fetchPlayer(uuid, lastFetchedAt, etag)
            GameMode.SKYWARS -> SkyWarsFetcher.fetchPlayer(uuid, lastFetchedAt, etag)
        }
    }
    
    /**
     * Build GameStats from a fetch result payload based on game mode.
     */
    fun buildGameStats(payload: JsonObject, gameMode: GameMode, etag: String? = null): GameStats {
        return when (gameMode) {
            GameMode.BEDWARS -> {
                val experience = BedwarsStar.extractExperience(payload)
                val star = experience?.let { BedwarsStar.calculateStar(it) }
                val fkdr = BedwarsFetcher.parseBedwarsFkdr(payload)
                val winstreak = BedwarsFetcher.parseBedwarsWinstreak(payload)
                GameStats.Bedwars(
                    star = star,
                    experience = experience,
                    fkdr = fkdr,
                    winstreak = winstreak,
                    fetchedAt = System.currentTimeMillis(),
                    etag = etag
                )
            }
            GameMode.DUELS -> {
                val wins = DuelsStats.parseWins(payload)
                val losses = DuelsStats.parseLosses(payload)
                val kills = DuelsStats.parseKills(payload)
                val deaths = DuelsStats.parseDeaths(payload)
                val winstreak = DuelsStats.parseWinstreak(payload)
                val bestWinstreak = DuelsStats.parseBestWinstreak(payload)
                GameStats.Duels(
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
            GameMode.SKYWARS -> {
                val experience = SkyWarsStats.parseExperience(payload)
                val level = experience?.let { SkyWarsStats.calculateLevel(it) }
                val wins = SkyWarsStats.parseWins(payload)
                val losses = SkyWarsStats.parseLosses(payload)
                val kills = SkyWarsStats.parseKills(payload)
                val deaths = SkyWarsStats.parseDeaths(payload)
                GameStats.SkyWars(
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
    }
    
    /**
     * Reset all fetcher warnings.
     */
    fun resetWarnings() {
        BedwarsFetcher.resetWarnings()
        DuelsFetcher.resetWarnings()
        SkyWarsFetcher.resetWarnings()
    }
}
