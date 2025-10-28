package me.beeny.bedwarslevelhead

import me.beeny.bedwarslevelhead.data.LevelCache
import me.beeny.bedwarslevelhead.events.EventSubscriber

object BedwarsLevelHead {
    val config = BedwarsLevelHeadConfig()
    val events = EventSubscriber

    fun init() {
        // Initialize the mod
        println("BedWars Level Head initializing...")
        LevelCache.initialize()
    }
}
