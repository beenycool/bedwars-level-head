package club.sk1er.mods.levelhead.core

import com.google.gson.JsonObject

object StatsPayloadParser {

    /**
     * Find a game mode stats object in a JSON payload.
     * Handles both Hypixel API structure and Proxy structures (top-level or under 'data').
     * Key is case-insensitive for proxy formats.
     */
    fun findStatsObject(json: JsonObject, gameMode: GameMode): JsonObject? {
        val targetKeys = when (gameMode) {
            GameMode.BEDWARS -> listOf("bedwars", "Bedwars")
            GameMode.DUELS -> listOf("duels", "Duels")
            GameMode.SKYWARS -> listOf("skywars", "SkyWars")
        }
        val targetKeySet = targetKeys.map { it.lowercase() }.toSet()

        // 1. Check for 'data' wrapper (Proxy single-player response)
        val data = json.get("data")?.takeIf { it.isJsonObject }?.asJsonObject
        if (data != null) {
            findKeyIgnoreCase(data, targetKeySet)?.let { return it }
        }

        // 2. Check for top-level keys (Proxy batch response or flat proxy response)
        findKeyIgnoreCase(json, targetKeySet)?.let { return it }

        // 3. Check for Hypixel API structure: player -> stats -> Mode
        val playerContainer = when {
            json.get("player")?.isJsonObject == true -> json.getAsJsonObject("player")
            json.get("stats")?.isJsonObject == true -> json
            else -> null
        }
        
        if (playerContainer != null) {
            val stats = playerContainer.get("stats")?.takeIf { it.isJsonObject }?.asJsonObject
            if (stats != null) {
                findKeyIgnoreCase(stats, targetKeySet)?.let { return it }
            }
        }

        // 4. Minimal flat schema fallback from community backend
        if (data != null) {
            buildMinimalStatsObject(data, gameMode)?.let { return it }
        }
        buildMinimalStatsObject(json, gameMode)?.let { return it }

        return null
    }

    fun isNicked(payload: JsonObject): Boolean {
        val data = payload.get("data")?.takeIf { it.isJsonObject }?.asJsonObject
        val player = payload.get("player")?.takeIf { it.isJsonObject }?.asJsonObject

        return payload.booleanValue("nicked") == true ||
            (payload.stringValue("display") ?: payload.stringValue("displayname")).isNickedDisplayName() ||
            (data?.booleanValue("nicked") == true) ||
            (data?.let { it.stringValue("display") ?: it.stringValue("displayname") }).isNickedDisplayName() ||
            (player?.booleanValue("nicked") == true) ||
            player?.stringValue("displayname").isNickedDisplayName()
    }

    private fun findKeyIgnoreCase(source: JsonObject, keys: Set<String>): JsonObject? {
        for ((key, value) in source.entrySet()) {
            if (key.lowercase() in keys && value.isJsonObject) {
                return value.asJsonObject
            }
        }
        return null
    }

    private fun JsonObject.booleanValue(key: String): Boolean? {
        val element = get(key) ?: return null
        if (element.isJsonNull) return null
        return kotlin.runCatching { element.asBoolean }.getOrNull()
    }

    private fun JsonObject.stringValue(key: String): String? {
        val element = get(key) ?: return null
        if (element.isJsonNull) return null
        return kotlin.runCatching { element.asString }.getOrNull()
    }

    private fun String?.isNickedDisplayName(): Boolean {
        return this?.trim()?.equals("(nicked)", ignoreCase = true) == true
    }

    private fun buildMinimalStatsObject(source: JsonObject, gameMode: GameMode): JsonObject? {
        val minimal = JsonObject()
        when (gameMode) {
            GameMode.BEDWARS -> {
                source.get("bedwars_experience")?.let { minimal.add("bedwars_experience", it) }
                source.get("bedwars_final_kills")?.let { minimal.add("final_kills_bedwars", it) }
                source.get("bedwars_final_deaths")?.let { minimal.add("final_deaths_bedwars", it) }
            }
            GameMode.DUELS -> {
                source.get("duels_wins")?.let { minimal.add("wins", it) }
                source.get("duels_losses")?.let { minimal.add("losses", it) }
                source.get("duels_kills")?.let { minimal.add("kills", it) }
                source.get("duels_deaths")?.let { minimal.add("deaths", it) }
            }
            GameMode.SKYWARS -> {
                source.get("skywars_experience")?.let { minimal.add("skywars_experience", it) }
                source.get("skywars_wins")?.let { minimal.add("wins", it) }
                source.get("skywars_losses")?.let { minimal.add("losses", it) }
                source.get("skywars_kills")?.let { minimal.add("kills", it) }
                source.get("skywars_deaths")?.let { minimal.add("deaths", it) }
            }
        }

        return if (minimal.entrySet().isNotEmpty()) minimal else null
    }
}
