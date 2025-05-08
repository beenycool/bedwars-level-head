package club.sk1er.mods.levelhead.core

import club.sk1er.mods.levelhead.Levelhead
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import gg.essential.universal.ChatColor
import okhttp3.Request
import java.awt.Color
import java.util.*
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit

/**
 * Handles direct communication with the Hypixel API for fetching Bedwars stars
 */
object HypixelApiHandler {
    private const val API_URL = "https://api.hypixel.net/player"
    private val playerDataCache = ConcurrentHashMap<String, PlayerData>()
    private val requestTimestamps = LinkedList<Long>()
    private val jsonParser = JsonParser()
    
    // Prestige colors based on Bedwars star ranges
    private val prestigeColors = listOf(
        PrestigeColor(0, ChatColor.GRAY.color!!),            // 0-99 (Gray)
        PrestigeColor(100, ChatColor.WHITE.color!!),         // 100-199 (White)
        PrestigeColor(200, ChatColor.GOLD.color!!),          // 200-299 (Gold)
        PrestigeColor(300, ChatColor.AQUA.color!!),          // 300-399 (Aqua)
        PrestigeColor(400, ChatColor.DARK_GREEN.color!!),    // 400-499 (Dark Green)
        PrestigeColor(500, ChatColor.DARK_AQUA.color!!),     // 500-599 (Dark Aqua)
        PrestigeColor(600, ChatColor.DARK_RED.color!!),      // 600-699 (Dark Red)
        PrestigeColor(700, ChatColor.LIGHT_PURPLE.color!!),  // 700-799 (Light Purple)
        PrestigeColor(800, ChatColor.BLUE.color!!),          // 800-899 (Blue)
        PrestigeColor(900, ChatColor.DARK_PURPLE.color!!),   // 900-999 (Dark Purple)
        PrestigeColor(1000, Color(255, 185, 255))            // 1000+ (Custom Pink)
    )
    
    /**
     * Gets the Bedwars stars of a player either from cache or the API
     */
    fun getPlayerBedwarsData(uuid: String): PlayerData? {
        // Check cache first
        val cachedData = playerDataCache[uuid]
        if (cachedData != null && System.currentTimeMillis() - cachedData.timestamp < TimeUnit.MINUTES.toMillis(5)) {
            return cachedData
        }
        
        // No valid cache, check if we can make an API request
        if (!canMakeRequest()) {
            return cachedData // Return outdated cache if available
        }
        
        // Make API request
        try {
            val apiKey = Levelhead.displayManager.config.hypixelApiKey
            if (apiKey.isEmpty()) {
                return null
            }
            
            val url = "$API_URL?key=$apiKey&uuid=$uuid"
            val request = Request.Builder()
                .url(url)
                .header("User-Agent", "Mozilla/4.76 (Bedwars Level Head V${Levelhead.VERSION})")
                .get()
                .build()
                
            val response = kotlin.runCatching {
                Levelhead.okHttpClient.newCall(request).execute().use { response ->
                    if (!response.isSuccessful) {
                        Levelhead.logger.error("Hypixel API returned error code: ${response.code()}")
                        return null
                    }
                    response.body()?.string()
                }
            }.getOrNull() ?: return null
            
            // Parse response
            val json = jsonParser.parse(response).asJsonObject
            
            if (!json["success"].asBoolean) {
                Levelhead.logger.error("Hypixel API returned error: ${json["cause"]?.asString ?: "Unknown"}")
                return null
            }
            
            if (!json.has("player") || json["player"].isJsonNull) {
                return null // Player not found
            }
            
            val player = json["player"].asJsonObject
            val stars = extractBedwarsStars(player)
            val playerData = PlayerData(stars, getPrestigeColor(stars), System.currentTimeMillis())
            
            // Update cache
            playerDataCache[uuid] = playerData
            return playerData
            
        } catch (e: Exception) {
            Levelhead.logger.error("Error fetching Bedwars data", e)
            return null
        }
    }
    
    /**
     * Extract Bedwars stars from player data
     */
    private fun extractBedwarsStars(player: JsonObject): Int {
        return try {
            // Path: player.achievements.bedwars_level
            if (player.has("achievements") && player["achievements"].asJsonObject.has("bedwars_level")) {
                player["achievements"].asJsonObject["bedwars_level"].asInt
            } else {
                0 // Default if not found
            }
        } catch (e: Exception) {
            Levelhead.logger.error("Error parsing Bedwars stars", e)
            0
        }
    }
    
    /**
     * Rate limiting: Ensure we don't exceed 30 requests per minute
     */
    private fun canMakeRequest(): Boolean {
        val currentTime = System.currentTimeMillis()
        
        // Remove timestamps older than 1 minute
        while (requestTimestamps.isNotEmpty() && currentTime - requestTimestamps.first > 60000) {
            requestTimestamps.removeFirst()
        }
        
        // Check if we can make another request
        if (requestTimestamps.size < 30) {
            requestTimestamps.add(currentTime)
            return true
        }
        
        return false
    }
    
    /**
     * Determine the color based on Bedwars prestige level
     */
    private fun getPrestigeColor(stars: Int): Color {
        // Find the appropriate prestige color based on star count
        for (i in prestigeColors.indices.reversed()) {
            if (stars >= prestigeColors[i].minStars) {
                return prestigeColors[i].color
            }
        }
        return prestigeColors.first().color
    }
    
    /**
     * Clears the player data cache
     */
    fun clearCache() {
        playerDataCache.clear()
    }
    
    /**
     * Helper classes
     */
    data class PlayerData(
        val stars: Int,
        val color: Color,
        val timestamp: Long
    )
    
    data class PrestigeColor(
        val minStars: Int,
        val color: Color
    )
}