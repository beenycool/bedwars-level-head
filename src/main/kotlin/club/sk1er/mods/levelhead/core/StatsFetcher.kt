package club.sk1er.mods.levelhead.core

import club.sk1er.mods.levelhead.Levelhead
import club.sk1er.mods.levelhead.bedwars.BedwarsFetcher
import club.sk1er.mods.levelhead.bedwars.FetchResult
import club.sk1er.mods.levelhead.duels.DuelsFetcher
import club.sk1er.mods.levelhead.duels.DuelsStats
import club.sk1er.mods.levelhead.skywars.SkyWarsFetcher
import club.sk1er.mods.levelhead.skywars.SkyWarsStats
import com.google.gson.JsonObject
import java.util.UUID

/**
 * Routes stat fetching requests to the appropriate game mode fetcher.
 * Provides a unified interface for fetching stats regardless of game mode.
 */
object StatsFetcher {
    
    /**
     * Fetch stats for a player in the specified game mode.
     */
    suspend fun fetchPlayer(
        uuid: UUID,
        gameMode: GameMode,
        lastFetchedAt: Long? = null,
        etag: String? = null
    ): FetchResult {
        val result = when (gameMode) {
            GameMode.BEDWARS -> BedwarsFetcher.fetchPlayer(uuid, lastFetchedAt, etag)
            GameMode.DUELS -> DuelsFetcher.fetchPlayer(uuid, lastFetchedAt, etag)
            GameMode.SKYWARS -> SkyWarsFetcher.fetchPlayer(uuid, lastFetchedAt, etag)
        }
        
        return result
    }
    
    /**
     * Build GameStats from a fetch result payload based on game mode.
     * Returns null if the payload does not contain stats for the specified game mode.
     */
    fun buildGameStats(payload: JsonObject, gameMode: GameMode, etag: String? = null): GameStats? {
        findStatsObject(payload, gameMode) ?: return null
        val nicked = isNicked(payload)
        
        return when (gameMode) {
            GameMode.BEDWARS -> {
                val experience = BedwarsStar.extractExperience(payload)
                val star = experience?.let { BedwarsStar.calculateStar(it) }
                val fkdr = BedwarsFetcher.parseBedwarsFkdr(payload)
                val winstreak = BedwarsFetcher.parseBedwarsWinstreak(payload)
                GameStats.Bedwars(
                    star = star,
                    experience = experience,
                    fkdr = fkdr,
                    winstreak = winstreak,
                    nicked = nicked,
                    fetchedAt = System.currentTimeMillis(),
                    etag = etag
                )
            }
            GameMode.DUELS -> {
                val wins = DuelsStats.parseWins(payload)
                val losses = DuelsStats.parseLosses(payload)
                val kills = DuelsStats.parseKills(payload)
                val deaths = DuelsStats.parseDeaths(payload)
                val winstreak = DuelsStats.parseWinstreak(payload)
                val bestWinstreak = DuelsStats.parseBestWinstreak(payload)
                GameStats.Duels(
                    wins = wins,
                    losses = losses,
                    kills = kills,
                    deaths = deaths,
                    winstreak = winstreak,
                    bestWinstreak = bestWinstreak,
                    nicked = nicked,
                    fetchedAt = System.currentTimeMillis(),
                    etag = etag
                )
            }
            GameMode.SKYWARS -> {
                val experience = SkyWarsStats.parseExperience(payload)
                val level = experience?.let { SkyWarsStats.calculateLevel(it) }
                val wins = SkyWarsStats.parseWins(payload)
                val losses = SkyWarsStats.parseLosses(payload)
                val kills = SkyWarsStats.parseKills(payload)
                val deaths = SkyWarsStats.parseDeaths(payload)
                GameStats.SkyWars(
                    level = level,
                    experience = experience,
                    wins = wins,
                    losses = losses,
                    kills = kills,
                    deaths = deaths,
                    nicked = nicked,
                    fetchedAt = System.currentTimeMillis(),
                    etag = etag
                )
            }
        }
    }

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

    private fun findKeyIgnoreCase(source: JsonObject, keys: Set<String>): JsonObject? {
        for ((key, value) in source.entrySet()) {
            if (key.lowercase() in keys && value.isJsonObject) {
                return value.asJsonObject
            }
        }
        return null
    }

    private fun isNicked(payload: JsonObject): Boolean {
        if (payload.booleanValue("nicked") == true) {
            return true
        }

        val topLevelDisplay = payload.stringValue("display") ?: payload.stringValue("displayname")
        if (topLevelDisplay.isNickedDisplayName()) {
            return true
        }

        val data = payload.get("data")?.takeIf { it.isJsonObject }?.asJsonObject
        if (data != null) {
            if (data.booleanValue("nicked") == true) {
                return true
            }
            val wrappedDisplay = data.stringValue("display") ?: data.stringValue("displayname")
            if (wrappedDisplay.isNickedDisplayName()) {
                return true
            }
        }

        val player = payload.get("player")?.takeIf { it.isJsonObject }?.asJsonObject
        if (player != null) {
            if (player.booleanValue("nicked") == true) {
                return true
            }
            if (player.stringValue("displayname").isNickedDisplayName()) {
                return true
            }
        }

        return false
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
    
    /**
     * Reset all fetcher warnings.
     */
    fun resetWarnings() {
        BedwarsFetcher.resetWarnings()
        DuelsFetcher.resetWarnings()
        SkyWarsFetcher.resetWarnings()
    }
}
