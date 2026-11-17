package club.sk1er.mods.levelhead.core

import club.sk1er.mods.levelhead.bedwars.BedwarsFetcher
import club.sk1er.mods.levelhead.bedwars.FetchResult
import club.sk1er.mods.levelhead.duels.DuelsFetcher
import club.sk1er.mods.levelhead.skywars.SkyWarsFetcher
import com.google.gson.JsonObject
import java.util.UUID

object StatsFetcher {

    private fun fetcher(gameMode: GameMode): GameModeFetcher = when (gameMode) {
        GameMode.BEDWARS -> BedwarsFetcher
        GameMode.DUELS -> DuelsFetcher
        GameMode.SKYWARS -> SkyWarsFetcher
    }

    suspend fun fetchPlayer(uuid: UUID, gameMode: GameMode): FetchResult {
        return fetcher(gameMode).fetch(uuid)
    }

    fun buildGameStats(payload: JsonObject, gameMode: GameMode): GameStats? {
        return fetcher(gameMode).buildStats(payload)
    }

    fun resetWarnings() {
        BedwarsFetcher.resetWarnings()
        DuelsFetcher.resetWarnings()
        SkyWarsFetcher.resetWarnings()
    }
}
