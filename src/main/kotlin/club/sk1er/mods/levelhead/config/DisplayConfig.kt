package club.sk1er.mods.levelhead.config

import club.sk1er.mods.levelhead.core.GameMode
import cc.polyfrost.oneconfig.config.core.OneColor
import java.awt.Color

class DisplayConfig(private val role: DisplayRole = DisplayRole.ABOVE_HEAD) {

    var gameMode: GameMode = GameMode.BEDWARS

    val displayRole: DisplayRole
        get() = role

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

    val headerEnabled: Boolean
        get() = when (role) {
            DisplayRole.ABOVE_HEAD -> LevelheadConfig.showHeader
            DisplayRole.TAB -> LevelheadConfig.tabShowHeader
        }

    var textShadow: Boolean
        get() = when (role) {
            DisplayRole.ABOVE_HEAD -> LevelheadConfig.textShadow
            DisplayRole.TAB -> LevelheadConfig.tabTextShadow
        }
        set(value) {
            when (role) {
                DisplayRole.ABOVE_HEAD -> LevelheadConfig.textShadow = value
                DisplayRole.TAB -> LevelheadConfig.tabTextShadow = value
            }
        }

    fun headerStringFor(gameMode: GameMode): String =
        if (headerEnabled) LevelheadConfig.headerLabelFor(gameMode) else ""

    fun footerTemplateFor(gameMode: GameMode): String = when (role) {
        DisplayRole.ABOVE_HEAD -> LevelheadConfig.footerTemplateFor(gameMode)
        DisplayRole.TAB -> LevelheadConfig.tabFooterTemplateFor(gameMode)
    }

    var headerColor: Color
        get() = when (role) {
            DisplayRole.ABOVE_HEAD -> LevelheadConfig.headerColor
            DisplayRole.TAB -> LevelheadConfig.tabHeaderColor
        }.toJavaColor()
        set(value) {
            when (role) {
                DisplayRole.ABOVE_HEAD -> LevelheadConfig.headerColor = OneColor(value)
                DisplayRole.TAB -> LevelheadConfig.tabHeaderColor = OneColor(value)
            }
        }

    var footerColor: Color
        get() = when (role) {
            DisplayRole.ABOVE_HEAD -> LevelheadConfig.footerColor
            DisplayRole.TAB -> LevelheadConfig.tabFooterColor
        }.toJavaColor()
        set(value) {
            when (role) {
                DisplayRole.ABOVE_HEAD -> LevelheadConfig.footerColor = OneColor(value)
                DisplayRole.TAB -> LevelheadConfig.tabFooterColor = OneColor(value)
            }
        }
}

enum class DisplayRole {
    ABOVE_HEAD,
    TAB
}
