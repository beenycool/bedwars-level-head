package club.sk1er.mods.levelhead.display

import club.sk1er.mods.levelhead.Levelhead
import club.sk1er.mods.levelhead.config.DisplayConfig
import net.minecraft.client.Minecraft
import net.minecraft.entity.player.EntityPlayer
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import kotlin.math.max

abstract class LevelheadDisplay(val displayPosition: DisplayPosition, val config: DisplayConfig) {
    val cache: ConcurrentHashMap<UUID, LevelheadTag> = ConcurrentHashMap()

    fun checkCacheSize() {
        val max = max(150, Levelhead.displayManager.config.purgeSize)
        if (cache.size > max) {
            val mc = Minecraft.getMinecraft()
            val world = mc.theWorld
            val uuids = world?.playerEntities?.mapTo(mutableSetOf()) { it.uniqueID } ?: emptySet()
            val cache2 = cache.filter { uuids.contains(it.key) }
            this.cache.clear()
            this.cache.putAll(cache2)
        }
    }

    open fun loadOrRender(player: EntityPlayer?): Boolean {
        player ?: return false
        return !player.displayName.formattedText.contains("\u00a7k", true)
    }

    enum class DisplayPosition {
        ABOVE_HEAD
    }
}
