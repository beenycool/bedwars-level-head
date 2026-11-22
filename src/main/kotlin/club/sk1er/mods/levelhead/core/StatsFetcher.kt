package club.sk1er.mods.levelhead.core

import club.sk1er.mods.levelhead.bedwars.FetchResult
import club.sk1er.mods.levelhead.bedwars.ProxyClient
import club.sk1er.mods.levelhead.skywars.SkyWarsStats
import com.google.gson.JsonObject
import java.util.UUID

object StatsFetcher {

    suspend fun fetchPlayer(uuid: UUID, gameMode: GameMode): FetchResult {
        if (!ProxyClient.isConfigured()) {
            DebugLogging.logRequestDebug {
                "[LevelheadDebug][direct] ${DebugSession.prefix()} offline-mode uuid=$uuid mode=${gameMode.name}"
            }
            return FetchResult.PermanentError("OFFLINE_MODE")
        }
        return ProxyClient.fetchPlayer(uuid.toString())
    }

    /**
     * The backend returns one flat payload for every mode, so the stats object is
     * resolved once here instead of once per field.
     */
    fun buildGameStats(payload: JsonObject, gameMode: GameMode): GameStats? {
        val stats = StatsPayloadParser.findStatsObject(payload, gameMode) ?: return null
        val nicked = StatsPayloadParser.isNicked(payload)
        return when (gameMode) {
            GameMode.BEDWARS -> buildBedwars(stats, nicked)
            GameMode.DUELS -> buildDuels(stats, nicked)
            GameMode.SKYWARS -> buildSkywars(stats, nicked)
        }
    }

    fun resetWarnings() {
        ProxyClient.resetWarnings()
    }

    private fun buildBedwars(stats: JsonObject, nicked: Boolean): GameStats.Bedwars {
        val experience = stats.longOrNull("bedwars_experience")
            ?: stats.longOrNull("Experience")
            ?: stats.longOrNull("experience")
        val star = experience?.let(BedwarsStar::calculateStar)
        val finalKills = stats.intOrNull("final_kills_bedwars") ?: stats.intOrNull("final_kills")
        val finalDeaths = stats.intOrNull("final_deaths_bedwars") ?: stats.intOrNull("final_deaths")
        return GameStats.Bedwars(
            star = star,
            fkdr = stats.doubleOrNull("fkdr") ?: ratioOf(finalKills, finalDeaths),
            nicked = nicked,
            fetchedAt = System.currentTimeMillis(),
            starIcon = BedwarsStar.iconForCosmetic(
                stats.stringOrNull("active_star") ?: stats.stringOrNull("bedwars_active_star")
            ),
            wins = stats.intOrNull("wins_bedwars") ?: stats.intOrNull("wins"),
            losses = stats.intOrNull("losses_bedwars") ?: stats.intOrNull("losses"),
            finalKills = finalKills,
            finalDeaths = finalDeaths,
            bedsBroken = stats.intOrNull("beds_broken_bedwars") ?: stats.intOrNull("beds_broken"),
            bedsLost = stats.intOrNull("beds_lost_bedwars") ?: stats.intOrNull("beds_lost")
        )
    }

    private fun buildDuels(stats: JsonObject, nicked: Boolean): GameStats.Duels = GameStats.Duels(
        wins = stats.intOrNull("wins"),
        losses = stats.intOrNull("losses"),
        kills = stats.intOrNull("kills"),
        deaths = stats.intOrNull("deaths"),
        nicked = nicked,
        fetchedAt = System.currentTimeMillis(),
        winstreak = stats.intOrNull("winstreak") ?: stats.intOrNull("current_winstreak")
    )

    private fun buildSkywars(stats: JsonObject, nicked: Boolean): GameStats.SkyWars {
        val experience = stats.longOrNull("skywars_experience")
            ?: stats.longOrNull("experience")
            ?: stats.longOrNull("Experience")
        return GameStats.SkyWars(
            level = experience?.let(SkyWarsStats::calculateLevel),
            wins = stats.intOrNull("wins"),
            losses = stats.intOrNull("losses"),
            kills = stats.intOrNull("kills"),
            deaths = stats.intOrNull("deaths"),
            nicked = nicked,
            fetchedAt = System.currentTimeMillis()
        )
    }

    private fun JsonObject.intOrNull(key: String): Int? {
        val element = get(key) ?: return null
        if (element.isJsonNull) return null
        return runCatching { element.asInt }.getOrNull()
    }

    private fun JsonObject.longOrNull(key: String): Long? {
        val element = get(key) ?: return null
        if (element.isJsonNull) return null
        return runCatching { element.asLong }.getOrNull()
    }

    private fun JsonObject.doubleOrNull(key: String): Double? {
        val element = get(key) ?: return null
        if (element.isJsonNull) return null
        return runCatching { element.asDouble }.getOrNull()
    }

    private fun JsonObject.stringOrNull(key: String): String? {
        val element = get(key) ?: return null
        if (element.isJsonNull || !element.isJsonPrimitive || !element.asJsonPrimitive.isString) return null
        return element.asString
    }
}
