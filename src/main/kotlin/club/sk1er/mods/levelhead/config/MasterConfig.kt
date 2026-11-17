package club.sk1er.mods.levelhead.config

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

    enum class DisplayPosition {
        ABOVE,
        BELOW
    }
}
