package club.sk1er.mods.levelhead.config

class MasterConfig {
    var enabled: Boolean = true
    var fontSize: Double = 1.0
    var offset: Double = 0.0

    var renderDistance: Int = 64
    var purgeSize: Int = 500
    var backgroundOpacity: Float = 0.25f // 25% opacity (0.0-1.0)
    var showBackground: Boolean = true
    var renderThrottleMs: Long = 0L
}