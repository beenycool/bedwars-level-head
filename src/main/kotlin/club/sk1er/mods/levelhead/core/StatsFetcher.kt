package club.sk1er.mods.levelhead.core

import club.sk1er.mods.levelhead.bedwars.BedwarsFetcher
import club.sk1er.mods.levelhead.bedwars.FetchResult
import club.sk1er.mods.levelhead.duels.DuelsFetcher
import club.sk1er.mods.levelhead.skywars.SkyWarsFetcher
import com.google.gson.JsonObject
import java.util.UUID

/**
 * Routes stat fetching requests to the appropriate game mode fetcher.
 * Provides a unified interface for fetching stats regardless of game mode.
 */
object StatsFetcher {

    private fun fetcher(gameMode: GameMode): GameModeFetcher = when (gameMode) {
        GameMode.BEDWARS -> BedwarsFetcher
        GameMode.DUELS -> DuelsFetcher
        GameMode.SKYWARS -> SkyWarsFetcher
    }

    /**
     * Fetch stats for a player in the specified game mode.
     */
    suspend fun fetchPlayer(
        uuid: UUID,
        gameMode: GameMode,
        lastFetchedAt: Long? = null,
        etag: String? = null
    ): FetchResult {
        return fetcher(gameMode).fetch(uuid, CacheHint(lastFetchedAt, etag))
    }

    /**
     * Build GameStats from a fetch result payload based on game mode.
     * Returns null if the payload does not contain stats for the specified game mode.
     */
    fun buildGameStats(payload: JsonObject, gameMode: GameMode, etag: String? = null): GameStats? {
        return fetcher(gameMode).buildStats(payload, etag)
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
