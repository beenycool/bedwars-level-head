package me.truffle.bedwarslevelhead.data

import java.util.concurrent.ConcurrentHashMap

object LevelCache {
    private val playerLevels = ConcurrentHashMap<String, PlayerLevelData>()
    private const val CACHE_DURATION = 30 * 60 * 1000 // 30 minutes

    fun initialize() {
        // Initialize cache
        playerLevels.clear()
    }

    fun updatePlayerLevel(playerName: String, level: Int) {
        playerLevels[playerName] = PlayerLevelData(playerName, level)
    }

    fun getPlayerLevel(playerName: String): PlayerLevelData? {
        val data = playerLevels[playerName]
        if (data != null && System.currentTimeMillis() - data.lastSeen > CACHE_DURATION) {
            playerLevels.remove(playerName)
            return null
        }
        return data
    }

    fun clearCache() {
        playerLevels.clear()
    }

    fun getCacheSize(): Int {
        return playerLevels.size
    }
}