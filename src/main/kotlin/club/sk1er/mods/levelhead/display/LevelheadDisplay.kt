package club.sk1er.mods.levelhead.display

import club.sk1er.mods.levelhead.Levelhead
import club.sk1er.mods.levelhead.config.DisplayConfig
import com.google.gson.JsonObject
import gg.essential.universal.ChatColor
import gg.essential.universal.UMinecraft
import net.minecraft.entity.player.EntityPlayer
import java.util.*
import java.util.concurrent.ConcurrentHashMap
import kotlin.math.max

abstract class LevelheadDisplay(val displayPosition: DisplayPosition, val config: DisplayConfig) {
    val cache: ConcurrentHashMap<UUID, LevelheadTag> = ConcurrentHashMap()

    fun checkCacheSize() {
        val max = max(150, Levelhead.displayManager.config.purgeSize)
        if (cache.size > max) {
            val uuids = UMinecraft.getMinecraft().theWorld.playerEntities.mapTo(mutableSetOf<UUID>()) { it.uniqueID }
            val cache2ElectricBoogaloo = cache.filter { uuids.contains(it.key) }
            this.cache.clear()
            this.cache.putAll(cache2ElectricBoogaloo)
        }
    }

    open fun loadOrRender(player: EntityPlayer?) = !player!!.displayName.formattedText.contains("§k", true)

    enum class DisplayPosition {
        ABOVE_HEAD
    }
}
