package club.sk1er.mods.levelhead.config

import club.sk1er.mods.levelhead.core.GameMode
import cc.polyfrost.oneconfig.config.core.OneColor
import java.awt.Color

class DisplayConfig(private val role: DisplayRole = DisplayRole.ABOVE_HEAD) {

    var gameMode: GameMode = GameMode.BEDWARS

    var enabled: Boolean
        get() = when (role) {
            DisplayRole.ABOVE_HEAD -> LevelheadConfig.levelheadEnabled
            DisplayRole.TAB -> LevelheadConfig.showTabStats
        }
        set(value) {
            when (role) {
                DisplayRole.ABOVE_HEAD -> LevelheadConfig.levelheadEnabled = value
                DisplayRole.TAB -> LevelheadConfig.showTabStats = value
            }
        }

    var showSelf: Boolean
        get() = LevelheadConfig.showSelf
        set(value) {
            LevelheadConfig.showSelf = value
        }

    fun headerStringFor(gameMode: GameMode): String = LevelheadConfig.headerTextFor(gameMode)

    var headerColor: Color
        get() = LevelheadConfig.headerColor.toJavaColor()
        set(value) {
            LevelheadConfig.headerColor = OneColor(value)
        }

    var footerColor: Color
        get() = LevelheadConfig.footerColor.toJavaColor()
        set(value) {
            LevelheadConfig.footerColor = OneColor(value)
        }
}

enum class DisplayRole {
    ABOVE_HEAD,
    TAB
}
