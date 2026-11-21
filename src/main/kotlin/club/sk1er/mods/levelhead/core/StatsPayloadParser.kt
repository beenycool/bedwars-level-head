package club.sk1er.mods.levelhead.core

import com.google.gson.JsonObject

object StatsPayloadParser {

    fun findStatsObject(json: JsonObject, gameMode: GameMode): JsonObject? {
        val targetKeys = when (gameMode) {
            GameMode.BEDWARS -> listOf("bedwars", "Bedwars")
            GameMode.DUELS -> listOf("duels", "Duels")
            GameMode.SKYWARS -> listOf("skywars", "SkyWars")
        }
        val targetKeySet = targetKeys.map { it.lowercase() }.toSet()

        val data = json.get("data")?.takeIf { it.isJsonObject }?.asJsonObject
        if (data != null) {
            findKeyIgnoreCase(data, targetKeySet)?.let { return it }
        }

        findKeyIgnoreCase(json, targetKeySet)?.let { return it }

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
                (source.get("bedwars_active_star") ?: source.get("active_star"))
                    ?.let { minimal.add("active_star", it) }
                source.get("bedwars_final_kills")?.let { minimal.add("final_kills_bedwars", it) }
                source.get("bedwars_final_deaths")?.let { minimal.add("final_deaths_bedwars", it) }
                source.get("bedwars_wins")?.let { minimal.add("wins_bedwars", it) }
                source.get("bedwars_losses")?.let { minimal.add("losses_bedwars", it) }
                source.get("bedwars_beds_broken")?.let { minimal.add("beds_broken_bedwars", it) }
                source.get("bedwars_beds_lost")?.let { minimal.add("beds_lost_bedwars", it) }
                source.get("bedwars_winstreak")?.let { minimal.add("winstreak", it) }
            }
            GameMode.DUELS -> {
                source.get("duels_wins")?.let { minimal.add("wins", it) }
                source.get("duels_losses")?.let { minimal.add("losses", it) }
                source.get("duels_kills")?.let { minimal.add("kills", it) }
                source.get("duels_deaths")?.let { minimal.add("deaths", it) }
                source.get("duels_winstreak")?.let { minimal.add("winstreak", it) }
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
