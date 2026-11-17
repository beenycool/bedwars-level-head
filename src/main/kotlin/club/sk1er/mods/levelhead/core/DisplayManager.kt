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

        /** Backend batch size; draining more per tick overlaps the next tick's batch. */
        private const val MAX_REQUESTS_PER_TICK = 20
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
    private var lastDebugSummaryAt: Long = 0L

    init {
        aboveHead.add(AboveHeadDisplay(DisplayConfig(DisplayRole.ABOVE_HEAD)))
        tab = TabDisplay(DisplayConfig(DisplayRole.TAB))
    }

    fun joinWorld(resetDetector: Boolean = false) {
        DebugSession.start("world-join")
        if (resetDetector) {
            ModeManager.onWorldJoin()
        }
        // A fresh world starts a new sample; the first scoreboard packet may not
        // have arrived yet, so the delayed fallback below re-samples once it has.
        ModeManager.invalidate()
        DebugLogging.logRequestDebug {
            "[LevelheadDebug][world] ${DebugSession.prefix()} join resetDetector=$resetDetector shouldRequest=${ModeManager.shouldRequestData()} mode=${ModeManager.getActiveGameMode()?.name ?: "none"} players=${Minecraft.getMinecraft().theWorld?.playerEntities?.size ?: 0}"
        }

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
                DebugLogging.logRequestDebug {
                    "[LevelheadDebug][world] ${DebugSession.prefix()} delayed sample shouldRequest=${ModeManager.shouldRequestData()} mode=${ModeManager.getActiveGameMode()?.name ?: "none"} players=${Minecraft.getMinecraft().theWorld?.playerEntities?.size ?: 0}"
                }
                if (!ModeManager.shouldRequestData()) return@runOnMain
                requestAllDisplays()
            }
        }
    }

    fun playerJoin(player: EntityPlayer) {
        val name = player.name
        val uuid = player.uniqueID
        if (!config.enabled) {
            DebugLogging.logRequestDebug {
                "[LevelheadDebug][join] ${DebugSession.prefix()} skip disabled uuid=$uuid name=$name"
            }
            return
        }
        if (player.isNPC) {
            DebugLogging.logRequestDebug {
                "[LevelheadDebug][join] ${DebugSession.prefix()} skip npc uuid=$uuid name=$name"
            }
            return
        }
        if (!ModeManager.shouldRequestData()) {
            DebugLogging.logRequestDebug {
                "[LevelheadDebug][join] ${DebugSession.prefix()} skip mode uuid=$uuid name=$name"
            }
            return
        }
        syncGameMode()
        val activeMode = ModeManager.getActiveGameMode() ?: run {
            DebugLogging.logRequestDebug {
                "[LevelheadDebug][join] ${DebugSession.prefix()} skip no-mode uuid=$uuid name=$name"
            }
            return
        }
        if (!FetchBackoff.canAttempt(uuid)) {
            DebugSession.inc("join_skipped_backoff")
            DebugLogging.logRequestDebug {
                "[LevelheadDebug][join] ${DebugSession.prefix()} skip backoff uuid=$uuid name=$name mode=${activeMode.name}"
            }
            return
        }
        if (!Levelhead.statsStore.needsFetch(uuid, activeMode)) {
            DebugSession.inc("join_skipped_fresh")
            DebugLogging.logRequestDebug {
                "[LevelheadDebug][join] ${DebugSession.prefix()} skip fresh uuid=$uuid name=$name mode=${activeMode.name}"
            }
            return
        }
        DebugSession.inc("join_enqueued")
        DebugLogging.logRequestDebug {
            "[LevelheadDebug][join] ${DebugSession.prefix()} enqueue uuid=$uuid name=$name mode=${activeMode.name}"
        }
        enqueueRequest(uuid.trimmed, activeMode.typeId, Levelhead.RequestReason.PLAYER_JOIN)
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
        DebugSession.inc("enqueue_total")
        DebugSession.inc("enqueue_${reason.name.lowercase()}")
        DebugLogging.logRequestDebug {
            "[LevelheadDebug][enqueue] ${DebugSession.prefix()} uuid=$uuid type=$type reason=$reason pending=${pendingRequests.size}"
        }
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

        if (now - lastDebugSummaryAt >= 60_000L) {
            lastDebugSummaryAt = now
            DebugLogging.logRequestDebug {
                "[LevelheadDebug][summary] ${DebugSession.summary(
                    "pending=${pendingRequests.size} mode=${ModeManager.getActiveGameMode()?.name ?: "none"} tabFetchIn=${(TAB_FETCH_INTERVAL_MS - (now - lastTabFetchAt)).coerceAtLeast(0)}ms"
                )}"
            }
        }

        // Periodically fetch stats for tab list players that aren't in the world
        // entity list, and refresh visible players whose stats have gone stale.
        if (LevelheadConfig.showTabStats && now - lastTabFetchAt > TAB_FETCH_INTERVAL_MS) {
            DebugSession.inc("tab_trigger")
            requestTabListPlayers()
            lastTabFetchAt = now
        }

        if (now - lastMissingRefreshAt > MISSING_RETRY_INTERVAL_MS) {
            DebugSession.inc("visible_trigger")
            refreshMissingVisibleDisplays()
            lastMissingRefreshAt = now
        }

        if (pendingRequests.isEmpty()) return
        DebugSession.inc("drain_ticks")
        val pendingBefore = pendingRequests.size
        val batch = ArrayList<Levelhead.LevelheadRequest>()
        synchronized(pendingRequests) {
            val it = pendingRequests.values.iterator()
            var count = 0
            while (it.hasNext() && count < MAX_REQUESTS_PER_TICK) {
                batch.add(it.next())
                it.remove()
                count++
            }
        }
        if (batch.isNotEmpty()) {
            DebugLogging.logRequestDebug {
                "[LevelheadDebug][drain] ${DebugSession.prefix()} pendingBefore=$pendingBefore batch=${batch.size} remaining=${pendingRequests.size} reasons=${batch.groupingBy { it.reason }.eachCount()}"
            }
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
        if (!config.enabled) {
            DebugSession.inc("visible_skipped_disabled")
            return
        }
        if (!ModeManager.shouldRequestData()) {
            DebugSession.inc("visible_skipped_mode")
            return
        }
        val activeMode = ModeManager.getActiveGameMode() ?: run {
            DebugSession.inc("visible_skipped_no_mode")
            return
        }
        if (buildActiveDisplayList().isEmpty()) {
            DebugSession.inc("visible_skipped_no_display")
            return
        }
        val players = Minecraft.getMinecraft().theWorld?.playerEntities ?: return
        val now = System.currentTimeMillis()
        var enqueued = 0
        var npc = 0
        var backoff = 0
        var fresh = 0
        for (player in players) {
            if (player.isNPC) {
                npc++
                continue
            }
            if (!FetchBackoff.canAttempt(player.uniqueID, now)) {
                backoff++
                continue
            }
            if (!Levelhead.statsStore.needsFetch(player.uniqueID, activeMode, now)) {
                fresh++
                continue
            }
            enqueued++
            enqueueRequest(
                player.uniqueID.trimmed,
                activeMode.typeId,
                Levelhead.RequestReason.REFRESH_VISIBLE_DISPLAYS
            )
        }
        DebugSession.inc("visible_scan")
        DebugSession.inc("visible_world_players", players.size)
        DebugSession.inc("visible_enqueued", enqueued)
        DebugSession.inc("visible_skipped_npc", npc)
        DebugSession.inc("visible_skipped_backoff", backoff)
        DebugSession.inc("visible_skipped_fresh", fresh)
        DebugLogging.logRequestDebug {
            "[LevelheadDebug][visible] ${DebugSession.prefix()} mode=${activeMode.name} worldPlayers=${players.size} enqueued=$enqueued npc=$npc fresh=$fresh backoff=$backoff pending=${pendingRequests.size}"
        }
    }

    /**
     * Request stats for players visible in the tab list but not yet fresh.
     * Tab list players may not be world entities, so requestAllDisplays() misses them.
     */
    private fun requestTabListPlayers() {
        if (!config.enabled) {
            DebugSession.inc("tab_skipped_disabled")
            return
        }
        if (!LevelheadConfig.showTabStats) {
            DebugSession.inc("tab_skipped_setting")
            return
        }
        if (!ModeManager.shouldRequestData()) {
            DebugSession.inc("tab_skipped_mode")
            return
        }
        val activeMode = ModeManager.getActiveGameMode() ?: run {
            DebugSession.inc("tab_skipped_no_mode")
            return
        }

        val netHandler = Minecraft.getMinecraft().thePlayer?.sendQueue ?: return
        val tabSize = netHandler.playerInfoMap.size
        val now = System.currentTimeMillis()
        var enqueued = 0
        var skippedVersion = 0
        var skippedBackoff = 0
        var skippedFresh = 0
        val sample = ArrayList<String>(5)
        for (info in netHandler.playerInfoMap) {
            val uuid = info.gameProfile.id ?: continue
            if (uuid.version() == 2) {
                skippedVersion++
                continue
            }
            if (!FetchBackoff.canAttempt(uuid, now)) {
                skippedBackoff++
                continue
            }
            if (!Levelhead.statsStore.needsFetch(uuid, activeMode, now)) {
                skippedFresh++
                continue
            }
            if (sample.size < 5) {
                sample.add(info.gameProfile.name ?: uuid.toString().take(8))
            }
            enqueued++
            enqueueRequest(uuid.trimmed, activeMode.typeId, Levelhead.RequestReason.TAB_LIST)
        }
        DebugSession.inc("tab_scan")
        DebugSession.inc("tab_tab_size", tabSize)
        DebugSession.inc("tab_enqueued", enqueued)
        DebugSession.inc("tab_skipped_version", skippedVersion)
        DebugSession.inc("tab_skipped_backoff", skippedBackoff)
        DebugSession.inc("tab_skipped_fresh", skippedFresh)
        DebugLogging.logRequestDebug {
            "[LevelheadDebug][tab] ${DebugSession.prefix()} mode=${activeMode.name} tabSize=$tabSize enqueued=$enqueued fresh=$skippedFresh backoff=$skippedBackoff v2=$skippedVersion pending=${pendingRequests.size} sample=${sample.joinToString(",")}"
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
        val world = Minecraft.getMinecraft().theWorld ?: run {
            DebugLogging.logRequestDebug {
                "[LevelheadDebug][world] ${DebugSession.prefix()} requestAllDisplays skipped: no world"
            }
            return
        }
        DebugLogging.logRequestDebug {
            "[LevelheadDebug][world] ${DebugSession.prefix()} requestAllDisplays snapshot players=${world.playerEntities.size}"
        }
        requestAllDisplays(world.playerEntities.map { it.uniqueID })
    }

    /** Request a set of UUIDs that was snapshotted on the main thread. */
    fun requestAllDisplays(uuids: Collection<UUID>) {
        if (!config.enabled) {
            DebugSession.inc("world_skipped_disabled")
            return
        }
        if (!ModeManager.shouldRequestData()) {
            DebugSession.inc("world_skipped_mode")
            return
        }

        // Sync game mode before requesting displays
        syncGameMode()

        if (buildActiveDisplayList().isEmpty()) {
            DebugSession.inc("world_skipped_no_display")
            return
        }
        val activeMode = ModeManager.getActiveGameMode() ?: run {
            DebugSession.inc("world_skipped_no_mode")
            return
        }
        val now = System.currentTimeMillis()
        var enqueued = 0
        var skippedVersion = 0
        var skippedBackoff = 0
        var skippedFresh = 0
        for (uuid in uuids) {
            if (uuid.version() == 2) {
                skippedVersion++
                continue
            }
            if (!FetchBackoff.canAttempt(uuid, now)) {
                skippedBackoff++
                continue
            }
            if (!Levelhead.statsStore.needsFetch(uuid, activeMode, now)) {
                skippedFresh++
                continue
            }
            enqueued++
            enqueueRequest(uuid.trimmed, activeMode.typeId, Levelhead.RequestReason.REQUEST_ALL_DISPLAYS)
        }
        DebugSession.inc("world_requested", uuids.size)
        DebugSession.inc("world_enqueued", enqueued)
        DebugSession.inc("world_skipped_version", skippedVersion)
        DebugSession.inc("world_skipped_backoff", skippedBackoff)
        DebugSession.inc("world_skipped_fresh", skippedFresh)
        DebugLogging.logRequestDebug {
            "[LevelheadDebug][world] ${DebugSession.prefix()} mode=${activeMode.name} requested=${uuids.size} enqueued=$enqueued fresh=$skippedFresh backoff=$skippedBackoff v2=$skippedVersion pending=${pendingRequests.size}"
        }
    }
}
