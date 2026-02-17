package club.sk1er.mods.levelhead.display

import club.sk1er.mods.levelhead.Levelhead
import club.sk1er.mods.levelhead.config.DisplayConfig
import com.google.gson.JsonObject
import net.minecraft.client.Minecraft
import net.minecraft.entity.player.EntityPlayer
import java.util.*
import java.util.concurrent.ConcurrentHashMap
import kotlin.math.max

abstract class LevelheadDisplay(val displayPosition: DisplayPosition, val config: DisplayConfig) {
    // Cache is keyed by (UUID, GameMode) to ensure mode-specific tags are served correctly
    val cache: ConcurrentHashMap<Levelhead.DisplayCacheKey, LevelheadTag> = ConcurrentHashMap()

    fun checkCacheSize() {
        val max = max(150, Levelhead.displayManager.config.purgeSize)
        if (cache.size > max) {
            val world = Minecraft.getMinecraft().theWorld ?: return
            val uuids = world.playerEntities.mapTo(mutableSetOf<UUID>()) { it.uniqueID }
            // Retain entries where the key's UUID is in the current world's player set
            val cache2ElectricBoogaloo = cache.filter { uuids.contains(it.key.uuid) }
            this.cache.clear()
            this.cache.putAll(cache2ElectricBoogaloo)
        }
    }

    open fun loadOrRender(player: EntityPlayer?) = !player!!.displayName.formattedText.contains("§k", true)

    enum class DisplayPosition {
        ABOVE_HEAD
    }
}
