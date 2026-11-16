package club.sk1er.mods.levelhead.core

import club.sk1er.mods.levelhead.bedwars.FetchResult
import com.google.gson.JsonObject
import java.util.UUID

interface GameModeFetcher {
    val gameMode: GameMode

    suspend fun fetch(uuid: UUID): FetchResult

    fun buildStats(payload: JsonObject): GameStats?

    fun resetWarnings()
}
