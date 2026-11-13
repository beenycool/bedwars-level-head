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
 *
 * The nametag and the tab list intentionally share the same header, footer
 * template, fallback colour and self-visibility; only the on/off switch differs.
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

    /** One switch for both renderers: a user never sees themselves twice by mistake. */
    var showSelf: Boolean
        get() = LevelheadConfig.showSelf
        set(value) {
            LevelheadConfig.showSelf = value
        }

    /** The header follows the detected game mode (B36). */
    val headerString: String
        get() = LevelheadConfig.headerTextFor(gameMode)

    var headerColor: Color
        get() = LevelheadConfig.headerColor.toJavaColor()
        set(value) {
            LevelheadConfig.headerColor = OneColor(value)
        }

    /** The stat's own colour wins where it has one; this is only the fallback. */
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
