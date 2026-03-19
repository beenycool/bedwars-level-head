package club.sk1er.mods.levelhead.core

import club.sk1er.mods.levelhead.bedwars.FetchResult
import com.google.gson.JsonObject
import java.util.UUID

data class CacheHint(
    val lastFetchedAt: Long? = null,
    val etag: String? = null
)

interface GameModeFetcher {
    val gameMode: GameMode

    suspend fun fetch(uuid: UUID, cacheHint: CacheHint = CacheHint()): FetchResult

    fun buildStats(payload: JsonObject, etag: String? = null): GameStats?

    fun resetWarnings()
}
