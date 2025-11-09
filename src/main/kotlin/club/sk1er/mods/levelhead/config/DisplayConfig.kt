package club.sk1er.mods.levelhead.config

import club.sk1er.mods.levelhead.core.BedwarsModeDetector
import org.polyfrost.oneconfig.api.config.v1.annotations.*
import org.polyfrost.polyui.color.PolyColor
import java.awt.Color

@Config(title = "Display Settings", description = "Configuration for above-head display")
object DisplayConfig {
    
    @Switch(
        title = "Enable Display", 
        description = "Enable the above-head level display"
    )
    var enabled: Boolean = true
    
    @Switch(
        title = "Show Self", 
        description = "Display your own level above your head"
    )
    var showSelf: Boolean = true
    
    @Dropdown(
        title = "Display Type", 
        description = "Type of information to display",
        options = [BedwarsModeDetector.BEDWARS_STAR_TYPE]
    )
    var type: String = BedwarsModeDetector.BEDWARS_STAR_TYPE
    
    @Text(
        title = "Header Text", 
        description = "Text to show before the level (e.g. 'Level')"
    )
    var headerString: String = BedwarsModeDetector.DEFAULT_HEADER
    
    @Color(title = "Header Color")
    var headerColor: PolyColor = PolyColor(0x00FFFF) // Cyan/Aqua
    
    @Switch(
        title = "Header Chroma", 
        description = "Enable rainbow colors for header text"
    )
    var headerChroma: Boolean = false
    
    @Text(
        title = "Footer Template", 
        description = "Template for footer text (%star% will be replaced with star level)"
    )
    var footerString: String? = null
    
    @Color(title = "Footer Color")
    var footerColor: PolyColor = PolyColor(0xFFFF00) // Yellow
    
    @Switch(
        title = "Footer Chroma", 
        description = "Enable rainbow colors for footer text"
    )
    var footerChroma: Boolean = false
}