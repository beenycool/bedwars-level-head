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
    private val fetchers: Map<GameMode, GameModeFetcher> = mapOf(
        GameMode.BEDWARS to BedwarsFetcher,
        GameMode.DUELS to DuelsFetcher,
        GameMode.SKYWARS to SkyWarsFetcher
    )

    fun fetcher(gameMode: GameMode): GameModeFetcher = fetchers.getValue(gameMode)

    /**
     * Fetch stats for a player in the specified game mode.
     */
    suspend fun fetchPlayer(
        uuid: UUID,
        gameMode: GameMode,
        lastFetchedAt: Long? = null,
        etag: String? = null
    ): FetchResult {
        return fetchers.getValue(gameMode).fetch(uuid, CacheHint(lastFetchedAt, etag))
    }

    /**
     * Build GameStats from a fetch result payload based on game mode.
     * Returns null if the payload does not contain stats for the specified game mode.
     */
    fun buildGameStats(payload: JsonObject, gameMode: GameMode, etag: String? = null): GameStats? {
        return fetchers.getValue(gameMode).buildStats(payload, etag)
    }

    /**
     * Find a game mode stats object in a JSON payload.
     * Delegates to StatsPayloadParser for backward compatibility.
     */
    fun findStatsObject(json: JsonObject, gameMode: GameMode): JsonObject? {
        return StatsPayloadParser.findStatsObject(json, gameMode)
    }

    /**
     * Reset all fetcher warnings.
     */
    fun resetWarnings() {
        fetchers.values.forEach { it.resetWarnings() }
    }
}
