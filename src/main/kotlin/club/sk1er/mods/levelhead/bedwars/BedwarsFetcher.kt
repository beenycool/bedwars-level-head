package club.sk1er.mods.levelhead.bedwars

import club.sk1er.mods.levelhead.core.BaseStatsFetcher
import club.sk1er.mods.levelhead.core.BedwarsStar
import club.sk1er.mods.levelhead.core.GameMode
import club.sk1er.mods.levelhead.core.GameStats
import club.sk1er.mods.levelhead.core.StatsPayloadParser
import com.google.gson.JsonObject
import java.util.UUID

object BedwarsFetcher : BaseStatsFetcher() {
    override val gameMode = GameMode.BEDWARS
    override val modeName = "BedWars"

    override fun resetWarnings() {
        super.resetWarnings()
        ProxyClient.resetWarnings()
    }

    override fun buildStats(payload: JsonObject, etag: String?): GameStats? {
        StatsPayloadParser.findStatsObject(payload, GameMode.BEDWARS) ?: return null
        val nicked = StatsPayloadParser.isNicked(payload)
        val experience = BedwarsStar.extractExperience(payload)
        val star = experience?.let { BedwarsStar.calculateStar(it) }
        val fkdr = parseBedwarsFkdr(payload)
        val winstreak = parseBedwarsWinstreak(payload)
        return GameStats.Bedwars(
            star = star,
            experience = experience,
            fkdr = fkdr,
            winstreak = winstreak,
            nicked = nicked,
            fetchedAt = System.currentTimeMillis(),
            etag = etag
        )
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
        return StatsPayloadParser.findStatsObject(json, GameMode.BEDWARS)
    }

    private fun JsonObject.numberValue(key: String): Double? {
        val element = get(key) ?: return null
        if (element.isJsonNull) return null
        return kotlin.runCatching { element.asDouble }.getOrNull()
    }
}
