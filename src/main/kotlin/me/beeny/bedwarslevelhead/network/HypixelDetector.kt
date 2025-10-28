package me.beeny.bedwarslevelhead.network

import me.beeny.bedwarslevelhead.utils.MinecraftUtils
import net.minecraft.util.StringUtils

object HypixelDetector {

    fun detectServer() {
        if (MinecraftUtils.isOnHypixel()) {
            println("Detected Hypixel server - BedWars Level Head is active")
        } else {
            println("Not on Hypixel - BedWars Level Head features limited")
        }
    }

    fun isOnBedWars(): Boolean {
        if (!MinecraftUtils.isOnHypixel()) return false

        val scoreboard = MinecraftUtils.getScoreboard() ?: return false
        val objective = scoreboard.getObjectiveInDisplaySlot(1) ?: return false
        val name = StringUtils.stripControlCodes(objective.displayName)

        return name.contains("BED WARS", ignoreCase = true)
    }
}
