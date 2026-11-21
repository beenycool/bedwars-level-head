package club.sk1er.mods.levelhead.bedwars

import club.sk1er.mods.levelhead.core.BaseStatsFetcher
import club.sk1er.mods.levelhead.core.BedwarsStar
import club.sk1er.mods.levelhead.core.GameMode
import club.sk1er.mods.levelhead.core.GameStats
import club.sk1er.mods.levelhead.core.StatsPayloadParser
import club.sk1er.mods.levelhead.core.ratioOf
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
        val starIcon = BedwarsStar.iconForCosmetic(
            bedwars.stringValue("active_star") ?: bedwars.stringValue("bedwars_active_star")
        )
        return GameStats.Bedwars(
            star = star,
            fkdr = fkdr,
            nicked = nicked,
            fetchedAt = System.currentTimeMillis(),
            starIcon = starIcon,
            wins = bedwars.intValue("wins_bedwars") ?: bedwars.intValue("wins"),
            losses = bedwars.intValue("losses_bedwars") ?: bedwars.intValue("losses"),
            finalKills = bedwars.intValue("final_kills_bedwars") ?: bedwars.intValue("final_kills"),
            finalDeaths = bedwars.intValue("final_deaths_bedwars") ?: bedwars.intValue("final_deaths"),
            bedsBroken = bedwars.intValue("beds_broken_bedwars") ?: bedwars.intValue("beds_broken"),
            bedsLost = bedwars.intValue("beds_lost_bedwars") ?: bedwars.intValue("beds_lost"),
            winstreak = bedwars.intValue("winstreak") ?: bedwars.intValue("bedwars_winstreak")
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

        val finalKills = bedwars.intValue("final_kills_bedwars") ?: bedwars.intValue("final_kills") ?: return null
        val finalDeaths = bedwars.intValue("final_deaths_bedwars") ?: bedwars.intValue("final_deaths") ?: return null
        return ratioOf(finalKills, finalDeaths)
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

    private fun JsonObject.intValue(key: String): Int? {
        val element = get(key) ?: return null
        if (element.isJsonNull) return null
        return kotlin.runCatching { element.asInt }.getOrNull()
    }

    private fun JsonObject.stringValue(key: String): String? {
        val element = get(key) ?: return null
        if (element.isJsonNull || !element.isJsonPrimitive || !element.asJsonPrimitive.isString) {
            return null
        }
        return element.asString
    }
}
