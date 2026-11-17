package club.sk1er.mods.levelhead.core

import club.sk1er.mods.levelhead.bedwars.FetchResult
import club.sk1er.mods.levelhead.bedwars.ProxyClient
import com.google.gson.JsonObject
import java.util.UUID
import club.sk1er.mods.levelhead.core.DebugLogging
import club.sk1er.mods.levelhead.core.DebugSession

abstract class BaseStatsFetcher : GameModeFetcher {

    abstract override val gameMode: GameMode
    protected abstract val modeName: String

    override suspend fun fetch(uuid: UUID): FetchResult {
        if (!ProxyClient.isConfigured()) {
            DebugLogging.logRequestDebug {
                "[LevelheadDebug][direct] ${DebugSession.prefix()} offline-mode uuid=$uuid mode=${gameMode.name}"
            }
            return FetchResult.PermanentError("OFFLINE_MODE")
        }
        return ProxyClient.fetchPlayer(uuid.toString())
    }

    abstract override fun buildStats(payload: JsonObject): GameStats?

    override fun resetWarnings() {
        ProxyClient.resetWarnings()
    }
}
