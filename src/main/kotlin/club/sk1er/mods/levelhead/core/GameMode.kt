package club.sk1er.mods.levelhead.core

/**
 * Enum representing different Hypixel game modes supported by the mod.
 * Each game mode has its own stat type and default display configuration.
 */
enum class GameMode(
    val typeId: String,
    val displayName: String,
    val defaultHeader: String,
    val statFormat: String,
    val description: String
) {
    BEDWARS(
        typeId = "BEDWARS_STAR",
        displayName = "BedWars",
        defaultHeader = "BedWars Star",
        statFormat = "%star%",
        description = "Display BedWars star level above players"
    ),
    DUELS(
        typeId = "DUELS_WINS",
        displayName = "Duels",
        defaultHeader = "Duels Division",
        statFormat = "%division%",
        description = "Display Duels division above players"
    ),
    SKYWARS(
        typeId = "SKYWARS_STAR",
        displayName = "SkyWars",
        defaultHeader = "SkyWars Star",
        statFormat = "%star%",
        description = "Display SkyWars star level above players"
    );

    companion object {
        /**
         * Get a GameMode from its type ID string.
         * Returns null if no matching game mode is found.
         */
        fun fromTypeId(typeId: String): GameMode? {
            return entries.find { it.typeId.equals(typeId, ignoreCase = true) }
        }

        /**
         * Resolve a type ID to a GameMode, defaulting to BEDWARS if unknown.
         * Logs the resolution at DEBUG level when a logger is provided.
         */
        fun resolve(typeId: String, logger: org.apache.logging.log4j.Logger? = null): GameMode {
            val resolved = fromTypeId(typeId) ?: BEDWARS
            logger?.debug("resolveGameMode: typeId={} -> {}", typeId, resolved)
            return resolved
        }

        /**
         * Get a GameMode from its display name.
         * Returns null if no matching game mode is found.
         */
        fun fromDisplayName(name: String): GameMode? {
            return entries.find { it.displayName.equals(name, ignoreCase = true) }
        }

        /**
         * Get all available game modes as a list of display names.
         */
        fun displayNames(): List<String> = entries.map { it.displayName }
    }
}
