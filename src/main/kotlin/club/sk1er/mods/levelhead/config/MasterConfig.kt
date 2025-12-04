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
    var frameSkip: Int = 1 // Render every N frames (1 = every frame, 2 = every other frame, etc.)
    var textShadow: Boolean = false // Whether to render text with shadow (disable to match Patcher nametag settings)
}