package club.sk1er.mods.levelhead.duels

object DuelsModeDetector {
    enum class Context {
        UNKNOWN,
        NONE,
    }

    fun currentContext(): Context = Context.NONE
}
