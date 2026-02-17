package club.sk1er.mods.levelhead.display

import club.sk1er.mods.levelhead.Levelhead
import club.sk1er.mods.levelhead.config.DisplayConfig
import club.sk1er.mods.levelhead.core.ModeManager
import com.google.gson.JsonObject
import net.minecraft.client.Minecraft
import net.minecraft.entity.player.EntityPlayer
import java.util.*
import java.util.concurrent.ConcurrentHashMap
import kotlin.math.max

abstract class LevelheadDisplay(val displayPosition: DisplayPosition, val config: DisplayConfig) {
    companion object {
        private const val CACHE_ENTRY_TTL_MS = 300_000L
    }

    // Cache is keyed by (UUID, GameMode) to ensure mode-specific tags are served correctly
    val cache: ConcurrentHashMap<Levelhead.DisplayCacheKey, LevelheadTag> = ConcurrentHashMap()


    fun checkCacheSize() {
        val max = max(150, Levelhead.displayManager.config.purgeSize)
        if (cache.size <= max) return

        val now = System.currentTimeMillis()
        val activeMode = ModeManager.getActiveGameMode()

        // Purge entries that are for a different game mode or haven't been seen recently.
        // This in-place removal avoids the GC pressure of creating intermediate maps.
        cache.entries.removeIf { (key, tag) ->
            val isStaleMode = activeMode != null && key.gameMode != activeMode
            val isOld = now - tag.lastSeen > CACHE_ENTRY_TTL_MS

            isStaleMode || isOld
        }

        // If still over max after timed purge, perform a hard purge of the oldest entries.
        if (cache.size > max) {
            val toRemoveCount = cache.size - max
            cache.entries
                .sortedBy { it.value.lastSeen }
                .take(toRemoveCount)
                .forEach { cache.remove(it.key) }
        }
    }
    open fun loadOrRender(player: EntityPlayer?) = !player!!.displayName.formattedText.contains("§k", true)

    enum class DisplayPosition {
        ABOVE_HEAD
    }
}
