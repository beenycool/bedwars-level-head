package club.sk1er.mods.levelhead.core

enum class GameMode(
    val typeId: String,
    val displayName: String,
    val defaultHeader: String,
    val statFormat: String
) {
    BEDWARS(
        typeId = "BEDWARS_STAR",
        displayName = "BedWars",
        defaultHeader = "BedWars Star",
        statFormat = "%star%"
    ),
    DUELS(
        typeId = "DUELS_WINS",
        displayName = "Duels",
        defaultHeader = "Duels Division",
        statFormat = "%division%"
    ),
    SKYWARS(
        typeId = "SKYWARS_STAR",
        displayName = "SkyWars",
        defaultHeader = "SkyWars Star",
        statFormat = "%star%"
    );

    companion object {
        fun fromTypeId(typeId: String): GameMode? {
            return entries.find { it.typeId.equals(typeId, ignoreCase = true) }
        }

        fun resolve(typeId: String, logger: org.apache.logging.log4j.Logger? = null): GameMode {
            val resolved = fromTypeId(typeId) ?: BEDWARS
            logger?.debug("resolveGameMode: typeId={} -> {}", typeId, resolved)
            return resolved
        }
    }
}
