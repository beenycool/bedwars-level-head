package club.sk1er.mods.levelhead.core

sealed class GameStats {
    data class Bedwars(
        val star: Int?,
        val etag: String? = null,
    ) : GameStats()

    data class Duels(
        val wins: Int?,
        val etag: String? = null,
    ) : GameStats()

    data class SkyWars(
        val level: Int?,
        val etag: String? = null,
    ) : GameStats()
}
