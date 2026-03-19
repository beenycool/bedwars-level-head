package club.sk1er.mods.levelhead.config.migration

import club.sk1er.mods.levelhead.Levelhead
import club.sk1er.mods.levelhead.core.GameMode
import com.google.gson.JsonObject

object ConfigMigrator {
    const val CURRENT_VERSION = 2

    private val LEGACY_BEDWARS_HEADERS = setOf("Level", "Levelhead", "Network Level", "BedWars Level")
    private val LEGACY_DUELS_HEADERS = setOf("Duels Wins")

    fun migrate(source: JsonObject): JsonObject {
        var version = 0

        if (source.has("master") && source.getAsJsonObject("master").has("version")) {
            version = source.getAsJsonObject("master").get("version").asInt
        }

        if (version >= CURRENT_VERSION) {
            return source
        }

        var migrated = source.deepCopy()

        if (version < 1) {
            migrated = migrateV0ToV1(migrated)
            version = 1
        }

        if (version < 2) {
            migrated = migrateV1ToV2(migrated)
            version = 2
        }

        if (!migrated.has("master")) {
            migrated.add("master", JsonObject())
        }
        migrated.getAsJsonObject("master").addProperty("version", CURRENT_VERSION)

        return migrated
    }

    private fun migrateV0ToV1(source: JsonObject): JsonObject {
        // v0 -> v1: Migrate legacy string types to gameMode enum
        if (source.has("head") && source.get("head").isJsonArray) {
            val headArray = source.getAsJsonArray("head")
            for (i in 0 until headArray.size()) {
                val display = headArray.get(i).asJsonObject

                // Read legacy 'type' and convert to 'gameMode'
                val typeElem = display.get("type")
                if (typeElem != null && typeElem.isJsonPrimitive && typeElem.asJsonPrimitive.isString) {
                    val typeStr = typeElem.asString
                    val gameMode = GameMode.fromTypeId(typeStr) ?: GameMode.BEDWARS
                    display.addProperty("gameMode", gameMode.name)
                } else if (!display.has("gameMode")) {
                    display.addProperty("gameMode", GameMode.BEDWARS.name)
                }
            }
        }
        return source
    }

    private fun migrateV1ToV2(source: JsonObject): JsonObject {
        // v1 -> v2: Migrate legacy primary display logic (forcing first display to BEDWARS and normalizing header)
        if (source.has("head") && source.get("head").isJsonArray) {
            val headArray = source.getAsJsonArray("head")
            for (i in 0 until headArray.size()) {
                val display = headArray.get(i).asJsonObject
                val modeElem = display.get("gameMode")
                val headerElem = display.get("headerString")
                val modeStr = if (modeElem != null && !modeElem.isJsonNull) modeElem.asString else GameMode.BEDWARS.name
                val headerStr = if (headerElem != null && !headerElem.isJsonNull) headerElem.asString else null

                if (modeStr != GameMode.BEDWARS.name) {
                    val previousType = modeStr
                    val normalizedHeader = normalizedManagedHeader(headerStr, GameMode.BEDWARS)

                    if (i == 0 && normalizedHeader != null && !headerStr.equals(normalizedHeader, ignoreCase = true)) {
                        display.addProperty("headerString", normalizedHeader)
                        runCatching { Levelhead.logger.info(
                            "Migrating legacy display #1 header '{}' -> '{}' while normalizing to BEDWARS.",
                            headerStr ?: "null",
                            normalizedHeader
                        ) }
                    }

                    runCatching { Levelhead.logger.info("Migrating legacy display #${i + 1} from mode '$previousType' to 'BEDWARS'.") }
                    display.addProperty("gameMode", GameMode.BEDWARS.name)
                }
            }
        }
        return source
    }

    internal fun managedHeaderMode(header: String?): GameMode? {
        if (header.isNullOrBlank()) {
            return null
        }

        return when {
            header.equals(GameMode.BEDWARS.defaultHeader, ignoreCase = true) -> GameMode.BEDWARS
            LEGACY_BEDWARS_HEADERS.any { header.equals(it, ignoreCase = true) } -> GameMode.BEDWARS
            header.equals(GameMode.DUELS.defaultHeader, ignoreCase = true) -> GameMode.DUELS
            LEGACY_DUELS_HEADERS.any { header.equals(it, ignoreCase = true) } -> GameMode.DUELS
            header.equals(GameMode.SKYWARS.defaultHeader, ignoreCase = true) -> GameMode.SKYWARS
            else -> null
        }
    }

    internal fun normalizedManagedHeader(header: String?, targetMode: GameMode): String? {
        if (header.isNullOrBlank() || managedHeaderMode(header) != null) {
            return targetMode.defaultHeader
        }
        return null
    }
}
