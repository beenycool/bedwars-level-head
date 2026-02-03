package club.sk1er.mods.levelhead.skywars

object SkyWarsStats {
    fun getDefaultEmblem(level: Int): String {
        return when {
            level >= 15 -> "✫"
            level >= 10 -> "✪"
            level >= 5 -> "✶"
            else -> "✦"
        }
    }
}
