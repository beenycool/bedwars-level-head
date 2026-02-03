package club.sk1er.mods.levelhead.core

import club.sk1er.mods.levelhead.bedwars.BedwarsFetcher
import club.sk1er.mods.levelhead.bedwars.FetchResult
import com.google.gson.JsonObject
import java.util.UUID

object StatsFetcher {
    suspend fun fetchPlayer(uuid: UUID, gameMode: GameMode): FetchResult {
        return when (gameMode) {
            GameMode.BEDWARS -> BedwarsFetcher.fetchPlayer(uuid, null, null)
            GameMode.DUELS, GameMode.SKYWARS -> FetchResult.PermanentError("UNSUPPORTED_MODE")
        }
    }

    fun buildGameStats(payload: JsonObject, gameMode: GameMode, etag: String? = null): GameStats? {
        return when (gameMode) {
            GameMode.BEDWARS -> {
                val experience = BedwarsFetcher.parseBedwarsExperience(payload)
                val star = experience?.let { BedwarsStar.calculateStar(it) }
                GameStats.Bedwars(star = star, etag = etag)
            }
            GameMode.DUELS -> GameStats.Duels(wins = null, etag = etag)
            GameMode.SKYWARS -> GameStats.SkyWars(level = null, etag = etag)
        }
    }
}
