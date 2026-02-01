package club.sk1er.mods.levelhead.config

import club.sk1er.mods.levelhead.core.GameMode
import java.awt.Color

class DisplayConfig {
    var enabled: Boolean = true
    var showSelf: Boolean = true
    var type: String = GameMode.BEDWARS.typeId

    var headerColor: Color = Color(85, 255, 255)
    var headerString: String = GameMode.BEDWARS.defaultHeader

    var footerColor: Color = Color(255, 255, 85)
    var footerString: String? = null

    /**
     * The game mode this display is configured for.
     * Uses string-based type for backward compatibility.
     */
    var gameMode: GameMode
        get() = GameMode.fromTypeId(type) ?: GameMode.BEDWARS
        set(value) {
            type = value.typeId
        }
}
