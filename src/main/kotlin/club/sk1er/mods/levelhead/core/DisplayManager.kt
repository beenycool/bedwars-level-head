package club.sk1er.mods.levelhead.core

import club.sk1er.mods.levelhead.config.DisplayConfig
import club.sk1er.mods.levelhead.config.MasterConfig
import club.sk1er.mods.levelhead.core.BedwarsModeDetector.Context
import club.sk1er.mods.levelhead.display.AboveHeadDisplay
import net.minecraft.client.Minecraft
import net.minecraftforge.fml.common.eventhandler.SubscribeEvent
import net.minecraftforge.fml.common.gameevent.TickEvent
import org.polyfrost.oneconfig.api.events.EventManager

class DisplayManager {

    // Config now references OneConfig directly instead of being loaded from file
    val config = object {
        val enabled: Boolean get() = MasterConfig.enabled
        val fontSize: Double get() = MasterConfig.fontSize
        val offset: Double get() = MasterConfig.offset
        val renderDistance: Int get() = MasterConfig.renderDistance
        val purgeSize: Int get() = MasterConfig.purgeSize
    }
    
    val aboveHead: MutableList<AboveHeadDisplay> = ArrayList()
    private var lastKnownContext: Context = Context.UNKNOWN

    init {
        // Initialize with default OneConfig display
        if (aboveHead.isEmpty()) {
            aboveHead.add(AboveHeadDisplay(DisplayConfig))
        }
    }

    fun readConfig() {
        // Config is now handled by OneConfig - no manual loading needed
        adjustIndices()
    }

    fun saveConfig() {
        // OneConfig handles saving automatically
    }

    fun adjustIndices() {
        for (i in aboveHead.indices) {
            aboveHead[i].bottomValue = i == 0
            aboveHead[i].index = i
        }
    }

    @SubscribeEvent
    fun tick(event: TickEvent.ClientTickEvent) {
        if (event.phase != TickEvent.Phase.END) return
        
        val currentContext = BedwarsModeDetector.currentContext()
        if (currentContext != lastKnownContext) {
            lastKnownContext = currentContext
            if (currentContext.isBedwars) {
                requestAllDisplays()
            } else {
                clearCachesWithoutRefetch()
            }
        }
    }

    fun joinWorld(resetDetector: Boolean) {
        if (resetDetector) {
            BedwarsModeDetector.onWorldJoin()
        }
        clearAll()
        if (MasterConfig.enabled) {
            requestAllDisplays()
        }
    }

    fun playerJoin(player: net.minecraft.entity.player.EntityPlayer) {
        if (!MasterConfig.enabled) return
        
        // Simplified - let the main Levelhead mod handle the display updates
        // This is called when a player joins but we don't need to fetch immediately
        // The main mod will handle updates in its tick
    }

    fun requestAllDisplays() {
        if (!MasterConfig.enabled) return
        
        val displays = aboveHead.filter { it.config.enabled }
        if (displays.isEmpty()) return
        
        val world = Minecraft.getMinecraft().theWorld
        if (world == null) return
        
        val playerEntities = world.playerEntities
        // Simplified - just trigger the update in the main mod
        // The main Levelhead mod will handle the display updates in its tick method
    }

    fun clearCachesWithoutRefetch() {
        aboveHead.forEach { it.cache.clear() }
    }

    fun clearAll() {
        aboveHead.forEach { it.cache.clear() }
    }

    fun setDisplay(playerName: String, displayText: String) {
        // This method is used by the simplified Levelhead mod
        // Could be enhanced to work with the display system
    }

    // Helper class to hold player information
    private data class PlayerInfo(val uuid: java.util.UUID, val name: String)
}
