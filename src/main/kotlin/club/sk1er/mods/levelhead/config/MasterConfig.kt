package club.sk1er.mods.levelhead.config

import org.polyfrost.oneconfig.api.config.v1.annotations.*

@Config(title = "Master Settings", description = "Master configuration for BedWars Levelhead")
object MasterConfig {
    
    @Switch(
        title = "Enable Mod", 
        description = "Enable or disable the entire mod"
    )
    var enabled: Boolean = true
    
    @Slider(
        title = "Font Size", 
        description = "Scale factor for the display text",
        min = 0.5f, 
        max = 3.0f, 
        step = 0.1f
    )
    var fontSize: Double = 1.0
    
    @Slider(
        title = "Display Offset", 
        description = "Vertical offset for the above-head display",
        min = -1.5f, 
        max = 3.0f, 
        step = 0.1f
    )
    var offset: Double = 0.0
    
    // These are constants in the original code
    val renderDistance: Int = 64
    val purgeSize: Int = 500
}