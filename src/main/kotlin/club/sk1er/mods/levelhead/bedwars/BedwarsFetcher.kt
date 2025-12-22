package club.sk1er.mods.levelhead.bedwars

import club.sk1er.mods.levelhead.Levelhead
import club.sk1er.mods.levelhead.config.LevelheadConfig
import club.sk1er.mods.levelhead.core.BackendMode
import com.google.gson.JsonObject
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import java.util.UUID

object BedwarsFetcher {
    suspend fun fetchPlayer(uuid: UUID, lastFetchedAt: Long?, etag: String? = null): FetchResult {
        return when (LevelheadConfig.backendMode) {
            BackendMode.OFFLINE -> {
                // In offline mode, return a permanent error indicating no network
                FetchResult.PermanentError("OFFLINE_MODE")
            }
            BackendMode.PROXY_ONLY -> {
                // Only use proxy, don't fall back to direct API
                if (ProxyClient.isAvailable()) {
                    ProxyClient.fetchPlayer(uuid.toString(), lastFetchedAt, etag)
                } else {
                    FetchResult.PermanentError("PROXY_UNAVAILABLE")
                }
            }
            BackendMode.DIRECT_API -> {
                // Only use direct Hypixel API
                val hypixelResult = HypixelClient.fetchPlayer(uuid)
                
                // Contribute to community database if new data fetched from Hypixel
                if (hypixelResult is FetchResult.Success && ProxyClient.canContribute()) {
                    Levelhead.scope.launch(Dispatchers.IO) {
                        ProxyClient.submitPlayer(uuid, hypixelResult.payload)
                    }
                }
                
                hypixelResult
            }
            BackendMode.FALLBACK -> {
                // Try proxy first, fall back to direct API
                if (ProxyClient.isAvailable()) {
                    val proxyResult = ProxyClient.fetchPlayer(uuid.toString(), lastFetchedAt, etag)
                    // Return proxy result if successful or cached (not an error state)
                    if (proxyResult is FetchResult.Success || proxyResult is FetchResult.NotModified) {
                        return proxyResult
                    }
                }

                val hypixelResult = HypixelClient.fetchPlayer(uuid)
                
                // Contribute to community database if new data fetched from Hypixel
                if (hypixelResult is FetchResult.Success && ProxyClient.canContribute()) {
                    Levelhead.scope.launch(Dispatchers.IO) {
                        ProxyClient.submitPlayer(uuid, hypixelResult.payload)
                    }
                }

                hypixelResult
            }
        }
    }

    suspend fun fetchProxyPlayer(identifier: String, lastFetchedAt: Long? = null, etag: String? = null): FetchResult {
        if (!ProxyClient.isAvailable()) {
            return FetchResult.PermanentError("PROXY_DISABLED")
        }
        return ProxyClient.fetchPlayer(identifier, lastFetchedAt, etag)
    }

    suspend fun fetchBatchFromProxy(uuids: List<UUID>): Map<UUID, FetchResult> {
        // In offline mode, return empty results
        if (LevelheadConfig.backendMode == BackendMode.OFFLINE) {
            return uuids.associateWith { FetchResult.PermanentError("OFFLINE_MODE") }
        }
        return ProxyClient.fetchBatch(uuids)
    }

    fun resetWarnings() {
        HypixelClient.resetWarnings()
        ProxyClient.resetWarnings()
    }

    fun parseBedwarsExperience(json: JsonObject): Long? {
        val bedwars = findBedwarsStats(json) ?: return null
        return parseExperienceFromBedwars(bedwars)
    }

    fun parseBedwarsFkdr(json: JsonObject): Double? {
        val bedwars = findBedwarsStats(json) ?: return null
        val fkdrElement = bedwars.get("fkdr")
        if (fkdrElement != null && !fkdrElement.isJsonNull) {
            return kotlin.runCatching { fkdrElement.asDouble }.getOrNull()
        }

        val finalKills = bedwars.numberValue("final_kills_bedwars") ?: 0.0
        val finalDeaths = bedwars.numberValue("final_deaths_bedwars") ?: 0.0
        if (finalKills == 0.0 && finalDeaths == 0.0) {
            return null
        }
        return if (finalDeaths <= 0) finalKills else finalKills / finalDeaths
    }

    fun parseBedwarsWinstreak(json: JsonObject): Int? {
        val bedwars = findBedwarsStats(json) ?: return null
        val element = bedwars.get("winstreak") ?: return null
        if (element.isJsonNull) return null
        return kotlin.runCatching { element.asInt }.getOrNull()
    }

    private fun parseExperienceFromBedwars(bedwars: JsonObject): Long? {
        return bedwars.entrySet()
            .firstOrNull { (key, _) ->
                key.equals("Experience", ignoreCase = true) || key.equals("bedwars_experience", ignoreCase = true)
            }
            ?.value
            ?.takeIf { !it.isJsonNull }
            ?.let { kotlin.runCatching { it.asLong }.getOrNull() }
    }

    private fun findBedwarsStats(json: JsonObject): JsonObject? {
        json.get("data")?.takeIf { it.isJsonObject }?.asJsonObject
            ?.get("bedwars")?.takeIf { it.isJsonObject }?.asJsonObject
            ?.let { return it }

        json.get("bedwars")?.takeIf { it.isJsonObject }?.asJsonObject
            ?.let { return it }

        val playerContainer = when {
            json.get("player")?.isJsonObject == true -> json.getAsJsonObject("player")
            json.get("stats")?.isJsonObject == true -> json
            else -> null
        } ?: return null

        val stats = playerContainer.get("stats")?.takeIf { it.isJsonObject }?.asJsonObject ?: return null
        return stats.get("Bedwars")?.takeIf { it.isJsonObject }?.asJsonObject
    }

    private fun JsonObject.numberValue(key: String): Double? {
        val element = get(key) ?: return null
        if (element.isJsonNull) return null
        return kotlin.runCatching { element.asDouble }.getOrNull()
    }
}
