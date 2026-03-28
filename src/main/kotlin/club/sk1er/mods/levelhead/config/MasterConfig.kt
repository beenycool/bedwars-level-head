package club.sk1er.mods.levelhead.config


import club.sk1er.mods.levelhead.config.migration.ConfigMigrator


class MasterConfig {
    var version: Int = ConfigMigrator.CURRENT_VERSION
    var enabled: Boolean = true
    var offset: Double = 0.0
    var displayPosition: DisplayPosition = DisplayPosition.ABOVE

    var renderDistance: Int = 64
    var purgeSize: Int = 500
    var backgroundOpacity: Float = 0.25f // 25% opacity (0.0-1.0)
    var showBackground: Boolean = true
    var renderThrottleMs: Long = 0L
    var frameSkip: Int = 1 // Render every N frames (1 = every frame, 2 = every other frame, etc.)
    var textShadow: Boolean = true // Whether to render text with shadow (disable to match Patcher nametag settings)

    enum class DisplayPosition {
        ABOVE,  // Display levelhead above the nametag (default)
        BELOW   // Display levelhead below the nametag
    }
}
