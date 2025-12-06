package club.sk1er.mods.levelhead.core

import club.sk1er.mods.levelhead.Levelhead
import club.sk1er.mods.levelhead.Levelhead.gson
import club.sk1er.mods.levelhead.Levelhead.jsonParser
import club.sk1er.mods.levelhead.config.DisplayConfig
import club.sk1er.mods.levelhead.config.MasterConfig
import club.sk1er.mods.levelhead.core.BedwarsModeDetector.Context
import club.sk1er.mods.levelhead.display.AboveHeadDisplay
import com.google.gson.JsonArray
import com.google.gson.JsonObject
import net.minecraft.client.Minecraft
import net.minecraft.entity.player.EntityPlayer
import org.apache.commons.io.FileUtils
import java.awt.Color
import java.io.File
import java.io.IOException
import java.nio.charset.StandardCharsets

class DisplayManager(val file: File) {

    var config = MasterConfig()
    val aboveHead: MutableList<AboveHeadDisplay> = ArrayList()
    private var lastKnownContext: Context = Context.UNKNOWN

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
        val jsonObject = JsonObject()
        jsonObject.add("master", gson.toJsonTree(config))

        val head = JsonArray()
        aboveHead.forEach { display ->
            head.add(gson.toJsonTree(display.config))
        }

        jsonObject.add("head", head)

        try {
            FileUtils.writeStringToFile(file, jsonObject.toString(), StandardCharsets.UTF_8)
        } catch (e: IOException) {
            Levelhead.logger.error("Failed to write to config.", e)
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
            if (display.config.type != BedwarsModeDetector.BEDWARS_STAR_TYPE) {
                if (index == 0 && legacyHeaders.any { display.config.headerString.equals(it, ignoreCase = true) }) {
                    display.config.headerString = BedwarsModeDetector.DEFAULT_HEADER
                }
                Levelhead.logger.info("Migrating legacy display #${index + 1} from type '${display.config.type}' to '${BedwarsModeDetector.BEDWARS_STAR_TYPE}'.")
                display.config.type = BedwarsModeDetector.BEDWARS_STAR_TYPE
                migrated = true
            }
        }
        return migrated
    }

    @OptIn(ExperimentalStdlibApi::class)
    fun joinWorld(resetDetector: Boolean = false) {
        if (resetDetector) {
            BedwarsModeDetector.onWorldJoin()
        }
        val context = BedwarsModeDetector.currentContext(force = resetDetector)
        if (!BedwarsModeDetector.shouldRequestData()) {
            if (lastKnownContext.isBedwars) {
                clearCachesWithoutRefetch()
            }
            lastKnownContext = context.takeUnless { it == Context.UNKNOWN } ?: lastKnownContext
            return
        }
        lastKnownContext = context.takeUnless { it == Context.UNKNOWN } ?: lastKnownContext
        requestAllDisplays()
    }

    @OptIn(ExperimentalStdlibApi::class)
    fun playerJoin(player: EntityPlayer) {
        if (!config.enabled) return
        if (player.isNPC) return
        if (!BedwarsModeDetector.shouldRequestData()) return
        val displays = aboveHead.filter { it.config.enabled }
        val requests = displays.filter { !it.cache.containsKey(player.uniqueID) }
            .map { display ->
                Levelhead.LevelheadRequest(player.uniqueID.trimmed, display, display.bottomValue)
            }
        
        if (requests.isNotEmpty()) {
            pendingRequests.addAll(requests)
        }
    }

    private val pendingRequests = java.util.concurrent.ConcurrentLinkedQueue<Levelhead.LevelheadRequest>()

    fun tick() {
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

    fun checkCacheSizes() {
        aboveHead.filter { it.config.enabled }.forEach { display ->
            display.checkCacheSize()
        }
    }

    fun clearCachesWithoutRefetch() {
        aboveHead.forEach { it.cache.clear() }
        Levelhead.clearCachedStats()
    }

    fun clearCache() {
        clearCachesWithoutRefetch()
        if (BedwarsModeDetector.shouldRequestData()) {
            requestAllDisplays()
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
        } else if (BedwarsModeDetector.shouldRequestData()) {
            requestAllDisplays()
        }

        return true
    }

    @OptIn(ExperimentalStdlibApi::class)
    fun requestAllDisplays() {
        if (!config.enabled) return
        if (!BedwarsModeDetector.shouldRequestData()) return
        val displays = aboveHead.filter { it.config.enabled }
        if (displays.isEmpty()) return
        Minecraft.getMinecraft().theWorld?.playerEntities
            ?.map { playerInfo ->
                displays.map { display ->
                    Levelhead.LevelheadRequest(playerInfo.uniqueID.trimmed, display, display.bottomValue)
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
        aboveHead.clear()
        val defaultDisplay = AboveHeadDisplay(DisplayConfig())
        // Ensure DisplayConfig defaults match LevelheadConfig defaults
        defaultDisplay.config.showSelf = true
        defaultDisplay.config.headerString = "BedWars"
        defaultDisplay.config.headerColor = Color(85, 255, 255)
        defaultDisplay.config.footerString = "%star%"
        aboveHead.add(defaultDisplay)
        adjustIndices()
        saveConfig()
        clearCachesWithoutRefetch()
        if (config.enabled && BedwarsModeDetector.shouldRequestData()) {
            requestAllDisplays()
        }
    }
}
