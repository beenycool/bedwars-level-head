package club.sk1er.mods.levelhead.core

import java.util.Collections
import java.util.LinkedHashMap
import java.util.UUID

import club.sk1er.mods.levelhead.Levelhead
import club.sk1er.mods.levelhead.config.LevelheadConfig
import club.sk1er.mods.levelhead.config.DisplayConfig
import club.sk1er.mods.levelhead.config.DisplayRole
import club.sk1er.mods.levelhead.config.MasterConfig
import club.sk1er.mods.levelhead.display.AboveHeadDisplay
import club.sk1er.mods.levelhead.display.TabDisplay
import net.minecraft.client.Minecraft
import net.minecraft.entity.player.EntityPlayer
import kotlinx.coroutines.delay

/**
 * Request queue and display lifecycle.
 *
 * The display tag caches are gone: renderers derive a tag from [StatsStore] through
 * [TagFormatter]. What remains here is "who should we ask about, and when", plus
 * the two display objects the renderer needs.
 */
class DisplayManager {
    companion object {
        private const val TAB_FETCH_INTERVAL_MS = 2000L
        private const val MISSING_RETRY_INTERVAL_MS = 2000L
    }

    /**
     * A view over the OneConfig settings; there is no second persisted store.
     * See [MasterConfig] and [DisplayConfig].
     */
    var config = MasterConfig()

    /** There is exactly one above-head display; nothing can create a second one. */
    val aboveHead: MutableList<AboveHeadDisplay> = ArrayList()
    lateinit var tab: TabDisplay
        private set
    private var lastTabFetchAt: Long = 0L
    private var lastMissingRefreshAt: Long = 0L

    init {
        aboveHead.add(AboveHeadDisplay(DisplayConfig(DisplayRole.ABOVE_HEAD)))
        tab = TabDisplay(DisplayConfig(DisplayRole.TAB))
    }

    fun joinWorld(resetDetector: Boolean = false) {
        if (resetDetector) {
            ModeManager.onWorldJoin()
        }
        // A fresh world starts a new sample; the first scoreboard packet may not
        // have arrived yet, so the delayed fallback below re-samples once it has.
        ModeManager.invalidate()

        if (ModeManager.shouldRequestData()) {
            requestAllDisplays()
            return
        }

        // Scoreboard packets haven't arrived yet (~1.5s). Re-check in the per-world
        // scope and do every client read on the main thread.
        Levelhead.launchWorld {
            delay(1500)
            Levelhead.runOnMain {
                if (Minecraft.getMinecraft().theWorld == null) return@runOnMain
                ModeManager.invalidate()
                if (!ModeManager.shouldRequestData()) return@runOnMain
                requestAllDisplays()
            }
        }
    }

    fun playerJoin(player: EntityPlayer) {
        if (!config.enabled) return
        if (player.isNPC) return
        if (!ModeManager.shouldRequestData()) return
        syncGameMode()
        val activeMode = ModeManager.getActiveGameMode() ?: return
        if (!FetchBackoff.canAttempt(player.uniqueID)) return
        if (!Levelhead.statsStore.needsFetch(player.uniqueID, activeMode)) return
        enqueueRequest(player.uniqueID.trimmed, activeMode.typeId, Levelhead.RequestReason.PLAYER_JOIN)
    }

    private data class RequestKey(val uuid: String, val type: String)
    private val pendingRequests: MutableMap<RequestKey, Levelhead.LevelheadRequest> = Collections.synchronizedMap(
        object : LinkedHashMap<RequestKey, Levelhead.LevelheadRequest>(128, 0.75f, false) {
            override fun removeEldestEntry(eldest: MutableMap.MutableEntry<RequestKey, Levelhead.LevelheadRequest>): Boolean {
                return size > 1000
            }
        }
    )

    private fun enqueueRequest(uuid: String, type: String, reason: Levelhead.RequestReason) {
        val key = RequestKey(uuid, type)
        synchronized(pendingRequests) {
            val existing = pendingRequests[key]
            pendingRequests[key] = if (existing != null) {
                existing.copy(
                    reason = if (existing.reason == reason) existing.reason else Levelhead.RequestReason.UNKNOWN
                )
            } else {
                Levelhead.LevelheadRequest(uuid, type, reason)
            }
        }
    }

    fun tick() {
        val now = System.currentTimeMillis()

        // Periodically fetch stats for tab list players that aren't in the world
        // entity list, and refresh visible players whose stats have gone stale.
        if (LevelheadConfig.showTabStats && now - lastTabFetchAt > TAB_FETCH_INTERVAL_MS) {
            requestTabListPlayers()
            lastTabFetchAt = now
        }

        if (now - lastMissingRefreshAt > MISSING_RETRY_INTERVAL_MS) {
            refreshMissingVisibleDisplays()
            lastMissingRefreshAt = now
        }

        if (pendingRequests.isEmpty()) return
        val batch = ArrayList<Levelhead.LevelheadRequest>()
        synchronized(pendingRequests) {
            val it = pendingRequests.values.iterator()
            var count = 0
            while (it.hasNext() && count < 32) {
                batch.add(it.next())
                it.remove()
                count++
            }
        }
        if (batch.isNotEmpty()) {
            Levelhead.requestCoordinator.fetchBatch(batch)
        }
    }

    /**
     * Clear the store and cancel in-flight work. Kept under its old name because
     * the config/command paths call it; display caches no longer exist, so this is
     * either "clear stats too" or a no-op.
     */
    fun clearCachesWithoutRefetch(clearStats: Boolean = true) {
        if (clearStats) {
            Levelhead.clearCachedStats()
        }
    }

    fun clearCache() {
        clearCachesWithoutRefetch()
        if (ModeManager.shouldRequestData()) {
            requestAllDisplays()
        }
    }

    /**
     * Re-request visible players whose stats are missing or stale. Runs on the
     * client tick (main thread), so reading the entity list is safe; the actual
     * HTTP work stays on the IO scope. [FetchBackoff] enforces the retry delay.
     */
    private fun refreshMissingVisibleDisplays() {
        if (!config.enabled) return
        if (!ModeManager.shouldRequestData()) return
        val activeMode = ModeManager.getActiveGameMode() ?: return
        if (buildActiveDisplayList().isEmpty()) return
        val players = Minecraft.getMinecraft().theWorld?.playerEntities ?: return
        val now = System.currentTimeMillis()
        for (player in players) {
            if (player.isNPC) continue
            if (!FetchBackoff.canAttempt(player.uniqueID, now)) continue
            if (!Levelhead.statsStore.needsFetch(player.uniqueID, activeMode, now)) continue
            enqueueRequest(
                player.uniqueID.trimmed,
                activeMode.typeId,
                Levelhead.RequestReason.REFRESH_VISIBLE_DISPLAYS
            )
        }
    }

    /**
     * Request stats for players visible in the tab list but not yet fresh.
     * Tab list players may not be world entities, so requestAllDisplays() misses them.
     */
    private fun requestTabListPlayers() {
        if (!LevelheadConfig.showTabStats) return
        if (!ModeManager.shouldRequestData()) return
        val activeMode = ModeManager.getActiveGameMode() ?: return

        val netHandler = Minecraft.getMinecraft().thePlayer?.sendQueue ?: return
        val now = System.currentTimeMillis()
        for (info in netHandler.playerInfoMap) {
            val uuid = info.gameProfile.id ?: continue
            if (uuid.version() == 2) continue
            if (!FetchBackoff.canAttempt(uuid, now)) continue
            if (!Levelhead.statsStore.needsFetch(uuid, activeMode, now)) continue
            enqueueRequest(uuid.trimmed, activeMode.typeId, Levelhead.RequestReason.TAB_LIST)
        }
    }

    fun primaryDisplay(): AboveHeadDisplay? = aboveHead.firstOrNull()

    /**
     * Sync the displays' game mode with the currently detected game mode.
     * Headers are computed from the mode, so there is no header text to copy (B36).
     */
    fun syncGameMode() {
        val detectedMode = ModeManager.getActiveGameMode() ?: run {
            Levelhead.logger.debug("syncGameMode: no active game mode, skipping")
            return
        }

        Levelhead.logger.debug("syncGameMode: detectedMode={} currentConfigGameMode={}",
            detectedMode, primaryDisplay()?.config?.gameMode)

        primaryDisplay()?.config?.gameMode = detectedMode
        tab.config.gameMode = detectedMode
    }

    /**
     * Build a list of all enabled displays (above-head and tab).
     */
    private fun buildActiveDisplayList(): List<club.sk1er.mods.levelhead.display.LevelheadDisplay> {
        val list = mutableListOf<club.sk1er.mods.levelhead.display.LevelheadDisplay>()
        aboveHead.filter { it.config.enabled }.forEach { list.add(it) }
        if (tab.config.enabled && LevelheadConfig.showTabStats) list.add(tab)
        return list
    }

    /** Snapshot the visible players on the calling (main) thread and request them. */
    fun requestAllDisplays() {
        val world = Minecraft.getMinecraft().theWorld ?: return
        requestAllDisplays(world.playerEntities.map { it.uniqueID })
    }

    /** Request a set of UUIDs that was snapshotted on the main thread. */
    fun requestAllDisplays(uuids: Collection<UUID>) {
        if (!config.enabled) return
        if (!ModeManager.shouldRequestData()) return

        // Sync game mode before requesting displays
        syncGameMode()

        if (buildActiveDisplayList().isEmpty()) return
        val activeMode = ModeManager.getActiveGameMode() ?: return
        val now = System.currentTimeMillis()
        for (uuid in uuids) {
            if (!FetchBackoff.canAttempt(uuid, now)) continue
            enqueueRequest(uuid.trimmed, activeMode.typeId, Levelhead.RequestReason.REQUEST_ALL_DISPLAYS)
        }
    }
}
