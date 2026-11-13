package club.sk1er.mods.levelhead.config

/**
 * Runtime view over the OneConfig settings.
 *
 * The mod used to keep a second, serialized copy of these values in
 * `config/levelhead.json`; every writer had to remember to copy one into the
 * other, which is where the "settings revert on restart" bugs came from. These
 * properties now read and write [LevelheadConfig] directly, so there is exactly
 * one value and no sync step to forget.
 *
 * The class is kept because the render package addresses
 * `displayManager.config.<field>` and `MasterConfig.DisplayPosition`.
 */
class MasterConfig {
    var enabled: Boolean
        get() = LevelheadConfig.levelheadEnabled
        set(value) {
            LevelheadConfig.levelheadEnabled = value
        }

    var offset: Double
        get() = LevelheadConfig.verticalOffset.toDouble()
        set(value) {
            LevelheadConfig.verticalOffset = value.toFloat()
        }

    var showBackground: Boolean
        get() = LevelheadConfig.showBackground
        set(value) {
            LevelheadConfig.showBackground = value
        }

    var backgroundOpacity: Float
        get() = LevelheadConfig.backgroundOpacity
        set(value) {
            LevelheadConfig.backgroundOpacity = value
        }

    var textShadow: Boolean
        get() = LevelheadConfig.textShadow
        set(value) {
            LevelheadConfig.textShadow = value
        }

    var displayPosition: DisplayPosition
        get() = DisplayPosition.entries.getOrNull(LevelheadConfig.displayPositionIndex) ?: DisplayPosition.ABOVE
        set(value) {
            LevelheadConfig.displayPositionIndex = value.ordinal
        }

    var renderDistance: Int
        get() = LevelheadConfig.renderDistance
        set(value) {
            LevelheadConfig.renderDistance = value
        }

    var purgeSize: Int
        get() = LevelheadConfig.cacheSizeLimit
        set(value) {
            LevelheadConfig.cacheSizeLimit = value
        }

    enum class DisplayPosition {
        ABOVE,
        BELOW
    }
}
