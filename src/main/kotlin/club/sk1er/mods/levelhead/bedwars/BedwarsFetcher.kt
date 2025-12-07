package club.sk1er.mods.levelhead.bedwars

import club.sk1er.mods.levelhead.Levelhead
import com.google.gson.JsonObject
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import java.util.UUID

object BedwarsFetcher {
    suspend fun fetchPlayer(uuid: UUID, lastFetchedAt: Long?, etag: String? = null): FetchResult {
        if (ProxyClient.isAvailable()) {
            // Using ProxyClient's fetch logic which handles sanitization internally
            return ProxyClient.fetchPlayer(uuid.toString(), lastFetchedAt, etag)
        }

        val hypixelResult = HypixelClient.fetchPlayer(uuid)
        
        // Contribute to community database if new data fetched from Hypixel
        if (hypixelResult is FetchResult.Success && ProxyClient.canContribute()) {
            Levelhead.scope.launch(Dispatchers.IO) {
                ProxyClient.submitPlayer(uuid, hypixelResult.payload)
            }
        }

        return hypixelResult
    }

    suspend fun fetchProxyPlayer(identifier: String, lastFetchedAt: Long? = null, etag: String? = null): FetchResult {
        if (!ProxyClient.isAvailable()) {
            return FetchResult.PermanentError("PROXY_DISABLED")
        }
        return ProxyClient.fetchPlayer(identifier, lastFetchedAt, etag)
    }

    suspend fun fetchBatchFromProxy(uuids: List<UUID>): Map<UUID, FetchResult> {
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
