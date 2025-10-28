package me.beeny.bedwarslevelhead.data

import java.util.concurrent.ConcurrentHashMap

object LevelCache {
    private val playerLevels = ConcurrentHashMap<String, PlayerLevelData>()
    private const val CACHE_DURATION = 30 * 60 * 1000L // 30 minutes
    private var lastCleanupTime = System.currentTimeMillis()
    private const val CLEANUP_INTERVAL = 5 * 60 * 1000L // 5 minutes

    fun initialize() {
        // Initialize cache
        playerLevels.clear()
    }

    fun updatePlayerLevel(playerName: String, level: Int) {
        playerLevels[playerName] = PlayerLevelData(playerName, level)
    }

    fun getPlayerLevel(playerName: String): PlayerLevelData? {
        // Periodic cleanup of expired entries
        cleanupExpiredEntries()

        // Atomic check-and-remove using computeIfPresent
        return playerLevels.computeIfPresent(playerName) { _, data ->
            if (System.currentTimeMillis() - data.lastSeen > CACHE_DURATION) {
                null // Remove the entry
            } else {
                data // Keep the entry
            }
        }
    }

    private fun cleanupExpiredEntries() {
        val now = System.currentTimeMillis()
        if (now - lastCleanupTime < CLEANUP_INTERVAL) return

        playerLevels.entries.removeIf { (_, data) ->
            now - data.lastSeen > CACHE_DURATION
        }
        lastCleanupTime = now
    }

    fun clearCache() {
        playerLevels.clear()
    }

    fun getCacheSize(): Int {
        return playerLevels.size
    }
}