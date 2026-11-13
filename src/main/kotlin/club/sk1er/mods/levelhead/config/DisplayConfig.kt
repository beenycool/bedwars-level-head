package club.sk1er.mods.levelhead.config

import club.sk1er.mods.levelhead.core.GameMode
import cc.polyfrost.oneconfig.config.core.OneColor
import java.awt.Color

/**
 * Runtime view over the OneConfig settings for one display target.
 *
 * Header/footer text, colours and visibility are computed from [LevelheadConfig],
 * so a change in the GUI is visible immediately and survives a restart without a
 * second config file. Only [gameMode] is runtime state: it follows the detected
 * game and is intentionally not persisted.
 */
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
        get() = when (role) {
            DisplayRole.ABOVE_HEAD -> LevelheadConfig.showSelf
            DisplayRole.TAB -> LevelheadConfig.tabShowSelf
        }
        set(value) {
            when (role) {
                DisplayRole.ABOVE_HEAD -> LevelheadConfig.showSelf = value
                DisplayRole.TAB -> LevelheadConfig.tabShowSelf = value
            }
        }

    /** The header follows the detected game mode (B36). */
    val headerString: String
        get() = LevelheadConfig.headerTextFor(gameMode)

    var headerColor: Color
        get() = LevelheadConfig.headerColor.toJavaColor()
        set(value) {
            LevelheadConfig.headerColor = OneColor(value)
        }

    var footerColor: Color
        get() = when (role) {
            DisplayRole.TAB -> LevelheadConfig.tabFooterColor.toJavaColor()
            else -> LevelheadConfig.footerColor.toJavaColor()
        }
        set(value) {
            when (role) {
                DisplayRole.TAB -> LevelheadConfig.tabFooterColor = OneColor(value)
                else -> LevelheadConfig.footerColor = OneColor(value)
            }
        }

    /**
     * Only the tab list can override the per-mode footer; as an above-head display
     * this is null and the per-mode template is used.
     */
    var footerString: String?
        get() = when (role) {
            DisplayRole.TAB -> LevelheadConfig.tabFooterFormat.ifBlank { null }
            else -> null
        }
        set(value) {
            if (role == DisplayRole.TAB) {
                LevelheadConfig.tabFooterFormat = value.orEmpty()
            }
        }
}

enum class DisplayRole {
    ABOVE_HEAD,
    TAB
}
