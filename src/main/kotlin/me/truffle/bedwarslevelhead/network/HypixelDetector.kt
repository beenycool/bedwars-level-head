package me.truffle.bedwarslevelhead.network

import me.truffle.bedwarslevelhead.utils.MinecraftUtils

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
        val name = objective.displayName

        return name.unformattedText.contains("BED WARS", ignoreCase = true)
    }
}