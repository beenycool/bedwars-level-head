package club.sk1er.mods.levelhead.core

import club.sk1er.mods.levelhead.bedwars.FetchResult
import club.sk1er.mods.levelhead.bedwars.ProxyClient
import com.google.gson.JsonObject
import java.util.UUID

/**
 * Base for the per-game fetchers. All data comes from the proxy backend; the
 * direct Hypixel API mode was removed because developer keys expire after a few
 * days and the mode could never keep working (B44).
 */
abstract class BaseStatsFetcher : GameModeFetcher {

    abstract override val gameMode: GameMode
    protected abstract val modeName: String

    override suspend fun fetch(uuid: UUID, cacheHint: CacheHint): FetchResult {
        if (!ProxyClient.isConfigured()) {
            return FetchResult.PermanentError("OFFLINE_MODE")
        }
        return ProxyClient.fetchPlayer(uuid.toString(), cacheHint.lastFetchedAt, cacheHint.etag)
    }

    abstract override fun buildStats(payload: JsonObject, etag: String?): GameStats?

    override fun resetWarnings() {
        ProxyClient.resetWarnings()
    }
}
