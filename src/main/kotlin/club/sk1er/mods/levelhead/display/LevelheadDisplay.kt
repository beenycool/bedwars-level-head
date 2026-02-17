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
    // Cache is keyed by (UUID, GameMode) to ensure mode-specific tags are served correctly
    val cache: ConcurrentHashMap<Levelhead.DisplayCacheKey, LevelheadTag> = ConcurrentHashMap()

    fun checkCacheSize() {
        val max = max(150, Levelhead.displayManager.config.purgeSize)
        if (cache.size > max) {
            val world = Minecraft.getMinecraft().theWorld ?: return
            val uuids = world.playerEntities.mapTo(HashSet<UUID>(world.playerEntities.size)) { it.uniqueID }
            val activeMode = ModeManager.getActiveGameMode()

            // Use removeIf to avoid creating intermediate maps and clearing/re-populating the cache.
            // This retains only entries for players in the current world and matching the active game mode.
            cache.entries.removeIf { entry ->
                !uuids.contains(entry.key.uuid) || (activeMode != null && entry.key.gameMode != activeMode)
            }
        }
    }

    open fun loadOrRender(player: EntityPlayer?) = !player!!.displayName.formattedText.contains("§k", true)

    enum class DisplayPosition {
        ABOVE_HEAD
    }
}
