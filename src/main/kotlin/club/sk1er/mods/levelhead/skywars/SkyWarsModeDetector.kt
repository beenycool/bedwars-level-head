package club.sk1er.mods.levelhead.skywars

object SkyWarsModeDetector {
    enum class Context {
        UNKNOWN,
        NONE,
    }

    fun currentContext(): Context = Context.NONE
}
