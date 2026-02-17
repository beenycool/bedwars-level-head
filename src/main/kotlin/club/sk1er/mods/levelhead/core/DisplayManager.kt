package club.sk1er.mods.levelhead.core

import club.sk1er.mods.levelhead.Levelhead
import club.sk1er.mods.levelhead.config.LevelheadConfig
import club.sk1er.mods.levelhead.Levelhead.gson
import club.sk1er.mods.levelhead.Levelhead.jsonParser
import club.sk1er.mods.levelhead.config.DisplayConfig
import club.sk1er.mods.levelhead.config.MasterConfig
import club.sk1er.mods.levelhead.display.AboveHeadDisplay
import com.google.gson.JsonArray
import com.google.gson.JsonObject
import net.minecraft.client.Minecraft
import net.minecraft.entity.player.EntityPlayer
import org.apache.commons.io.FileUtils
import java.awt.Color
import java.util.*
import java.io.File
import java.io.IOException
import java.nio.charset.StandardCharsets
import kotlinx.coroutines.launch

class DisplayManager(val file: File) {
    companion object {
        private const val LAST_SEEN_UPDATE_INTERVAL_MS = 5000L
        private const val CACHE_CHECK_INTERVAL_MS = 10000L
    }

    var config = MasterConfig()
    val aboveHead: MutableList<AboveHeadDisplay> = ArrayList()
    private var wasInGame: Boolean = false
    private var lastCacheCheckAt: Long = 0L
    private var lastSeenUpdateAt: Long = 0L
    private val reusableUuidSet = HashSet<UUID>()

    init {
        readConfig()
    }

    fun readConfig() {
        try {
            var shouldSaveCopyNow = false
            var migrated = false
            if (!file.exists()) {
                file.createNewFile()
                shouldSaveCopyNow = true
            }
            val source = runCatching {
                jsonParser.parse(FileUtils.readFileToString(file, StandardCharsets.UTF_8)).asJsonObject
            }.getOrElse { JsonObject() }
            if (source.has("master")) {
                config = gson.fromJson(source["master"].asJsonObject, MasterConfig::class.java)
            }

            if (source.has("head")) {
                for (head in source["head"].asJsonArray) {
                    aboveHead.add(AboveHeadDisplay(gson.fromJson(head.asJsonObject, DisplayConfig::class.java)))
                }
            }

            if (aboveHead.isEmpty()) {
                aboveHead.add(AboveHeadDisplay(DisplayConfig()))
                migrated = true
            }

            if (migrateLegacyPrimaryDisplay()) {
                migrated = true
            }

            adjustIndices()

            if (shouldSaveCopyNow || migrated) {
                saveConfig()
            }
        } catch (e: IOException) {
            Levelhead.logger.error("Failed to initialize display manager.", e)
        }
    }

    fun saveConfig() {
        val headSnapshot = synchronized(aboveHead) {
            aboveHead.map { gson.toJsonTree(it.config) }
        }
        val masterSnapshot = gson.toJsonTree(config)

        Levelhead.scope.launch(kotlinx.coroutines.Dispatchers.IO) {
            val jsonObject = JsonObject()
            jsonObject.add("master", masterSnapshot)

            val head = JsonArray()
            headSnapshot.forEach { displayConfig ->
                head.add(displayConfig)
            }

            jsonObject.add("head", head)

            try {
                FileUtils.writeStringToFile(file, jsonObject.toString(), StandardCharsets.UTF_8)
            } catch (e: IOException) {
                Levelhead.logger.error("Failed to write to config.", e)
            }
        }
    }

    fun adjustIndices() {
        for (i in aboveHead.indices) {
            aboveHead[i].bottomValue = i == 0
            aboveHead[i].index = i
        }
    }

    private fun migrateLegacyPrimaryDisplay(): Boolean {
        var migrated = false
        val legacyHeaders = setOf("Level", "Levelhead", "Network Level")
        aboveHead.forEachIndexed { index, display ->
            if (display.config.type != GameMode.BEDWARS.typeId) {
                if (index == 0 && legacyHeaders.any { display.config.headerString.equals(it, ignoreCase = true) }) {
                    display.config.headerString = GameMode.BEDWARS.defaultHeader
                }
                Levelhead.logger.info("Migrating legacy display #${index + 1} from type '${display.config.type}' to '${GameMode.BEDWARS.typeId}'.")
                display.config.type = GameMode.BEDWARS.typeId
                migrated = true
            }
        }
        return migrated
    }

    @OptIn(ExperimentalStdlibApi::class)
    fun joinWorld(resetDetector: Boolean = false) {
        if (resetDetector) {
            ModeManager.onWorldJoin()
        }
        
        val inGame = ModeManager.shouldRequestData()
        if (!inGame) {
            if (wasInGame) {
                clearCachesWithoutRefetch()
            }
            wasInGame = false
            return
        }
        
        wasInGame = true
        // requestAllDisplays() will automatically sync the game mode
        requestAllDisplays()
    }

    @OptIn(ExperimentalStdlibApi::class)
    fun playerJoin(player: EntityPlayer) {
        if (!config.enabled) return
        if (player.isNPC) return
        if (!ModeManager.shouldRequestData()) return
        syncGameMode()
        val activeMode = ModeManager.getActiveGameMode() ?: return
        val displays = aboveHead.filter { it.config.enabled }
        val requests = displays.filter { !it.cache.containsKey(Levelhead.DisplayCacheKey(player.uniqueID, activeMode)) }
            .map { display ->
                Levelhead.LevelheadRequest(player.uniqueID.trimmed, display, display.bottomValue, reason = Levelhead.RequestReason.PLAYER_JOIN)
            }
        
        if (requests.isNotEmpty()) {
            pendingRequests.addAll(requests)
        }
    }

    private val pendingRequests = java.util.concurrent.ConcurrentLinkedQueue<Levelhead.LevelheadRequest>()


    fun tick() {
        val now = System.currentTimeMillis()

        // Periodically update lastSeen for all players in the world to keep their cache entries alive.
        // This ensures that present but non-rendered players (e.g., behind the player) aren't purged.
        if (now - lastSeenUpdateAt > LAST_SEEN_UPDATE_INTERVAL_MS) {
            updateLastSeen()
            lastSeenUpdateAt = now
        }

        // Periodically purge old or excessive cache entries.
        if (now - lastCacheCheckAt > CACHE_CHECK_INTERVAL_MS) {
            checkCacheSizes()
            lastCacheCheckAt = now
        }

        if (pendingRequests.isEmpty()) return
        val batch = ArrayList<Levelhead.LevelheadRequest>()
        var req = pendingRequests.poll()
        while (req != null) {
            batch.add(req)
            req = pendingRequests.poll()
        }
        if (batch.isNotEmpty()) {
            Levelhead.fetchBatch(batch)
        }
    }

    private fun updateLastSeen() {
        val world = Minecraft.getMinecraft().theWorld ?: return
        val now = System.currentTimeMillis()
        val activeMode = ModeManager.getActiveGameMode() ?: return

        // Scan world players and refresh their lastSeen timestamp in the display caches.
        // Using a reusable set avoids the GC factory problem of allocating a new set every check.
        reusableUuidSet.clear()
        world.playerEntities.forEach { reusableUuidSet.add(it.uniqueID) }

        aboveHead.forEach { display ->
            if (!display.config.enabled) return@forEach
            display.cache.forEach { (key, tag) ->
                if (key.gameMode == activeMode && key.uuid in reusableUuidSet) {
                    tag.lastSeen = now
                }
            }
        }
    }

    fun checkCacheSizes() {
        aboveHead.filter { it.config.enabled }.forEach { display ->
            display.checkCacheSize()
        }
    }
    fun clearCachesWithoutRefetch(clearStats: Boolean = true) {
        val activeMode = ModeManager.getActiveGameMode()
        Levelhead.logger.debug("clearCachesWithoutRefetch: clearStats={} activeMode={} cacheSizesBefore={}", 
            clearStats, activeMode, aboveHead.map { it.cache.size })
        
        aboveHead.forEach { it.cache.clear() }
        if (clearStats) {
            Levelhead.clearCachedStats()
        }
        Levelhead.logger.debug("clearCachesWithoutRefetch: COMPLETED cacheSizesAfter={}", aboveHead.map { it.cache.size })
    }

    fun clearCache() {
        clearCachesWithoutRefetch()
        if (ModeManager.shouldRequestData()) {
            requestAllDisplays()
        }
    }

    /**
     * Refresh visible player tags without requiring mode detection to be active.
     * Used for config-only changes (for example, footer format switches) so updates
     * apply immediately in the current world/session.
     */
    @OptIn(ExperimentalStdlibApi::class)
    fun refreshVisibleDisplays() {
        if (!config.enabled) return

        val displays = aboveHead.filter { it.config.enabled }
        if (displays.isEmpty()) return

        Minecraft.getMinecraft().theWorld?.playerEntities
            ?.map { playerInfo ->
                displays.map { display ->
                    Levelhead.LevelheadRequest(playerInfo.uniqueID.trimmed, display, display.bottomValue, reason = Levelhead.RequestReason.REFRESH_VISIBLE_DISPLAYS)
                }
            }
            ?.flatten()
            ?.let { requests ->
                if (requests.isNotEmpty()) {
                    Levelhead.fetchBatch(requests)
                }
            }
    }

    fun primaryDisplay(): AboveHeadDisplay? = aboveHead.firstOrNull()

    fun updatePrimaryDisplay(mutator: (DisplayConfig) -> Boolean): Boolean {
        val display = primaryDisplay() ?: return false
        val changed = mutator(display.config)
        if (!changed) {
            return false
        }
        saveConfig()
        LevelheadConfig.requestSync()
        return true
    }

    fun applyPrimaryDisplayConfigToCache() {
        val display = primaryDisplay() ?: return
        val headerValue = "${display.config.headerString}: "
        display.cache.values.forEach { tag ->
            tag.header.value = headerValue
            tag.header.color = display.config.headerColor
        }
    }

    fun setEnabled(enabled: Boolean): Boolean {
        if (config.enabled == enabled) {
            return false
        }

        config.enabled = enabled
        saveConfig()

        if (!enabled) {
            clearCachesWithoutRefetch()
        } else if (ModeManager.shouldRequestData()) {
            requestAllDisplays()
        }

        return true
    }

    /**
     * Automatically sync the display config's game mode with the currently detected game mode.
     */
    @OptIn(ExperimentalStdlibApi::class)
    fun syncGameMode() {
        val detectedMode = ModeManager.getActiveGameMode() ?: run {
            Levelhead.logger.debug("syncGameMode: no active game mode, skipping")
            return
        }

        Levelhead.logger.debug("syncGameMode: detectedMode={} currentConfigGameMode={} currentConfigType={}", 
            detectedMode, primaryDisplay()?.config?.gameMode, primaryDisplay()?.config?.type)

        updatePrimaryDisplay { config ->
            if (config.gameMode != detectedMode) {
                val previousMode = config.gameMode
                val previousType = config.type
                config.gameMode = detectedMode
                if (config.type == previousMode.typeId) {
                    config.type = detectedMode.typeId
                }
                if (config.headerString.isBlank() || matchesModeDefaultHeader(config.headerString, previousMode)) {
                    config.headerString = detectedMode.defaultHeader
                }
                Levelhead.logger.debug("syncGameMode: CHANGED gameMode={}->{} type={}->{} header={}", 
                    previousMode, detectedMode, previousType, config.type, config.headerString)
                true
            } else {
                false
            }
        }
    }

    private fun matchesModeDefaultHeader(header: String, mode: GameMode): Boolean {
        if (header.equals(mode.defaultHeader, ignoreCase = true)) {
            return true
        }

        return when (mode) {
            GameMode.BEDWARS -> header.equals("BedWars Level", ignoreCase = true)
            GameMode.DUELS -> header.equals("Duels Wins", ignoreCase = true)
            GameMode.SKYWARS -> false
        }
    }

    @OptIn(ExperimentalStdlibApi::class)
    fun requestAllDisplays() {
        if (!config.enabled) return
        if (!ModeManager.shouldRequestData()) return
        
        // Sync game mode before requesting displays
        syncGameMode()
        
        val displays = aboveHead.filter { it.config.enabled }
        if (displays.isEmpty()) return
        Minecraft.getMinecraft().theWorld?.playerEntities
            ?.map { playerInfo ->
                displays.map { display ->
                    Levelhead.LevelheadRequest(playerInfo.uniqueID.trimmed, display, display.bottomValue, reason = Levelhead.RequestReason.REQUEST_ALL_DISPLAYS)
                }
            }
            ?.flatten()
            ?.let { Levelhead.fetchBatch(it) }
    }

    fun resetToDefaults() {
        config = MasterConfig()
        // Ensure defaults match LevelheadConfig defaults
        config.renderDistance = 64
        config.purgeSize = 500
        config.backgroundOpacity = 0.25f
        config.showBackground = true
        config.renderThrottleMs = 0L
        config.frameSkip = 1
        config.textShadow = false
        config.displayPosition = MasterConfig.DisplayPosition.ABOVE
        aboveHead.clear()
        val defaultDisplay = AboveHeadDisplay(DisplayConfig())
        // Ensure DisplayConfig defaults match LevelheadConfig defaults
        defaultDisplay.config.showSelf = true
        defaultDisplay.config.headerString = GameMode.BEDWARS.defaultHeader
        defaultDisplay.config.headerColor = Color(85, 255, 255)
        defaultDisplay.config.footerString = "%star%"
        defaultDisplay.config.type = GameMode.BEDWARS.typeId
        aboveHead.add(defaultDisplay)
        adjustIndices()
        saveConfig()
        clearCachesWithoutRefetch()
        if (config.enabled && ModeManager.shouldRequestData()) {
            requestAllDisplays()
        }
    }
}
