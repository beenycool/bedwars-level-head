package club.sk1er.mods.levelhead.bedwars

import club.sk1er.mods.levelhead.core.BaseStatsFetcher
import club.sk1er.mods.levelhead.core.BedwarsStar
import club.sk1er.mods.levelhead.core.GameMode
import club.sk1er.mods.levelhead.core.GameStats
import club.sk1er.mods.levelhead.core.StatsPayloadParser
import com.google.gson.JsonObject

object BedwarsFetcher : BaseStatsFetcher() {
    override val gameMode = GameMode.BEDWARS
    override val modeName = "BedWars"

    override fun resetWarnings() {
        super.resetWarnings()
        ProxyClient.resetWarnings()
    }

    override fun buildStats(payload: JsonObject): GameStats? {
        val bedwars = findBedwarsStats(payload) ?: return null
        val nicked = StatsPayloadParser.isNicked(payload)
        val experience = parseBedwarsExperience(payload)
        val star = experience?.let { BedwarsStar.calculateStar(it) }
        val fkdr = parseBedwarsFkdr(payload)
        val starIcon = BedwarsStar.iconForCosmetic(bedwars.stringValue("active_star"))
        return GameStats.Bedwars(
            star = star,
            fkdr = fkdr,
            nicked = nicked,
            fetchedAt = System.currentTimeMillis(),
            starIcon = starIcon
        )
    }

    private fun parseBedwarsExperience(json: JsonObject): Long? {
        val bedwars = findBedwarsStats(json) ?: return null
        return parseExperienceFromBedwars(bedwars)
    }

    private fun parseBedwarsFkdr(json: JsonObject): Double? {
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

    private fun JsonObject.stringValue(key: String): String? {
        val element = get(key) ?: return null
        if (element.isJsonNull || !element.isJsonPrimitive || !element.asJsonPrimitive.isString) {
            return null
        }
        return element.asString
    }
}
