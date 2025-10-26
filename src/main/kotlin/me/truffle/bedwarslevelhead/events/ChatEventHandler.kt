package me.truffle.bedwarslevelhead.events

import me.truffle.bedwarslevelhead.data.LevelCache
import me.truffle.bedwarslevelhead.utils.ChatUtils

object ChatEventHandler {

    fun handleChatMessage(message: String) {
        val detectedLevel = ChatUtils.extractLevelFromMessage(message)
        if (detectedLevel != null) {
            val playerName = ChatUtils.extractPlayerNameFromMessage(message)
            if (playerName != null) {
                LevelCache.updatePlayerLevel(playerName, detectedLevel)

                if (BedwarsLevelHead.config.debug) {
                    println("Detected level $detectedLevel for player $playerName")
                }
            }
        }
    }
}