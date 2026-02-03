package club.sk1er.mods.levelhead.core

enum class GameMode(
    val typeId: String,
    val displayName: String,
    val defaultHeader: String,
) {
    BEDWARS(BedwarsModeDetector.BEDWARS_STAR_TYPE, "BedWars", BedwarsModeDetector.DEFAULT_HEADER),
    DUELS("DUELS", "Duels", "Duels Wins"),
    SKYWARS("SKYWARS", "SkyWars", "SkyWars Level");

    companion object {
        fun fromTypeId(typeId: String?): GameMode? {
            if (typeId.isNullOrBlank()) return null
            return entries.firstOrNull { it.typeId.equals(typeId, ignoreCase = true) }
        }
    }
}
