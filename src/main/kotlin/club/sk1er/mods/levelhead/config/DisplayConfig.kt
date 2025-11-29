package club.sk1er.mods.levelhead.config

import club.sk1er.mods.levelhead.core.BedwarsModeDetector
import java.awt.Color

class DisplayConfig {
    var enabled: Boolean = true
    var showSelf: Boolean = true
    var type: String = BedwarsModeDetector.BEDWARS_STAR_TYPE

    var headerColor: Color = Color(85, 255, 255)
    var headerString: String = BedwarsModeDetector.DEFAULT_HEADER

    var footerColor: Color = Color(255, 255, 85)
    var footerString: String? = null
}