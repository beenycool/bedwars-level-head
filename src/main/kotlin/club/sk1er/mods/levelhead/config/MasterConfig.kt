package club.sk1er.mods.levelhead.config

class MasterConfig {
    var enabled: Boolean = true
    var fontSize: Double = 1.0
    var offset: Double = 0.0

    val renderDistance: Int = 64
    val purgeSize: Int = 500
    
    // Hypixel API settings
    var hypixelApiKey: String = ""
    var useDirectApiAccess: Boolean = false
    var onlyInBedwars: Boolean = true
}