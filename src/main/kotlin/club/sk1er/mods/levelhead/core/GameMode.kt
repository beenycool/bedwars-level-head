package club.sk1er.mods.levelhead.core

enum class GameMode(
    val displayName: String,
    val defaultHeader: String
) {
    BEDWARS(
        displayName = "BedWars",
        defaultHeader = "BedWars Star"
    ),
    DUELS(
        displayName = "Duels",
        defaultHeader = "Duels Division"
    ),
    SKYWARS(
        displayName = "SkyWars",
        defaultHeader = "SkyWars Star"
    );
}
