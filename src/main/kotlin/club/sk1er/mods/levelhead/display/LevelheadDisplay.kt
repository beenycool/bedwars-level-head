package club.sk1er.mods.levelhead.display

import club.sk1er.mods.levelhead.Levelhead
import club.sk1er.mods.levelhead.config.DisplayConfig
import net.minecraft.entity.player.EntityPlayer
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import kotlin.math.max

abstract class LevelheadDisplay(val displayPosition: DisplayPosition, val config: DisplayConfig) {
    val cache: ConcurrentHashMap<UUID, LevelheadTag> = ConcurrentHashMap()

    fun checkCacheSize() {
        val max = max(150, Levelhead.displayManager.config.purgeSize)
        if (cache.size > max) {
            val now = System.currentTimeMillis()
            cache.entries.removeIf { (_, tag) -> (now - tag.lastRendered) > 5 * 60 * 1000 }

            if (cache.size > max) {
                val sortedByRecent = cache.entries.sortedBy { it.value.lastRendered }
                val toRemove = sortedByRecent.take(cache.size - max)
                toRemove.forEach { cache.remove(it.key) }
            }
        }
    }

    open fun loadOrRender(player: EntityPlayer?) = !player!!.displayName.formattedText.contains("§k", true)

    enum class DisplayPosition {
        ABOVE_HEAD
    }
}
