package club.sk1er.mods.levelhead

import cc.polyfrost.oneconfig.utils.commands.CommandManager
import club.sk1er.mods.levelhead.bedwars.BedwarsFetcher
import club.sk1er.mods.levelhead.commands.LevelheadCommand
import club.sk1er.mods.levelhead.config.LevelheadConfig
import club.sk1er.mods.levelhead.core.BedwarsModeDetector
import club.sk1er.mods.levelhead.core.BedwarsStar
import club.sk1er.mods.levelhead.core.DisplayManager
import club.sk1er.mods.levelhead.core.RateLimiter
import club.sk1er.mods.levelhead.core.RateLimiter.Metrics
import club.sk1er.mods.levelhead.core.dashUUID
import club.sk1er.mods.levelhead.core.trimmed
import club.sk1er.mods.levelhead.display.LevelheadDisplay
import club.sk1er.mods.levelhead.display.LevelheadTag
import club.sk1er.mods.levelhead.render.AboveHeadRender
import com.google.gson.Gson
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import net.minecraft.client.Minecraft
import net.minecraft.client.entity.EntityPlayerSP
import net.minecraft.entity.player.EntityPlayer
import net.minecraft.util.ChatComponentText
import net.minecraft.util.EnumChatFormatting as ChatColor
import net.minecraftforge.common.MinecraftForge
import net.minecraftforge.event.entity.EntityJoinWorldEvent
import net.minecraftforge.fml.common.Mod
import net.minecraftforge.fml.common.event.FMLPostInitializationEvent
import net.minecraftforge.fml.common.event.FMLPreInitializationEvent
import net.minecraftforge.fml.common.eventhandler.SubscribeEvent
import net.minecraftforge.fml.common.network.FMLNetworkEvent
import okhttp3.Dns
import okhttp3.OkHttpClient
import okhttp3.Request
import org.apache.logging.log4j.LogManager
import org.apache.logging.log4j.Logger
import java.awt.Color
import java.io.File
import java.net.Inet4Address
import java.net.UnknownHostException
import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import java.time.Duration
import java.util.Locale
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong
import kotlin.random.Random

@Mod(
    modid = Levelhead.MODID,
    name = "BedWars Levelhead",
    version = Levelhead.VERSION,
)
class LevelheadMod {
    @Mod.EventHandler
    fun preInit(event: FMLPreInitializationEvent) {
        Levelhead.preInit(event)
    }

    @Mod.EventHandler
    fun postInit(event: FMLPostInitializationEvent) {
        Levelhead.postInit(event)
    }
}

object Levelhead {
    val logger: Logger = LogManager.getLogger()
    private val ipv4OnlyDns = Dns { hostname ->
        val addresses = Dns.SYSTEM.lookup(hostname).filterIsInstance<Inet4Address>()
        if (addresses.isEmpty()) {
            throw UnknownHostException("No IPv4 addresses for $hostname")
        }
        addresses
    }

    val okHttpClient: OkHttpClient = OkHttpClient.Builder()
        .dns(ipv4OnlyDns)
        .connectTimeout(5, TimeUnit.SECONDS)
        .readTimeout(10, TimeUnit.SECONDS)
        .writeTimeout(10, TimeUnit.SECONDS)
        .callTimeout(15, TimeUnit.SECONDS)
        .build()
    val gson = Gson()
    val jsonParser = JsonParser()

    private val configFile by lazy { File(File(minecraft.mcDataDir, "config"), "levelhead.json") }
    val displayManager: DisplayManager by lazy { DisplayManager(configFile) }
    private val modJob: Job = SupervisorJob()
    val scope: CoroutineScope = CoroutineScope(modJob + Dispatchers.IO)
    private val worldScopeLock = Any()
    @Volatile
    private var worldJob: Job = SupervisorJob(modJob)
    @Volatile
    private var worldScope: CoroutineScope = CoroutineScope(worldJob + Dispatchers.IO)
    val rateLimiter: RateLimiter = RateLimiter(150, Duration.ofMinutes(5))

    private val statsCache: ConcurrentHashMap<UUID, CachedBedwarsStats> = ConcurrentHashMap()
    private val inFlightStatsRequests: ConcurrentHashMap<UUID, Deferred<CachedBedwarsStats?>> = ConcurrentHashMap()
    private val pendingDisplayRefreshes: ConcurrentHashMap<UUID, MutableSet<LevelheadDisplay>> = ConcurrentHashMap()
    private val starFetchSemaphore: Semaphore = Semaphore(6)
    private val rateLimiterNotified = AtomicBoolean(false)
    private val statsCacheMetrics = StatsCacheMetrics()
    private val serverCooldownNotifiedUntil = AtomicLong(0L)
    private val updateCheckScheduled = AtomicBoolean(false)
    @Volatile
    private var lastFetchAttemptAt: Long = 0L
    @Volatile
    private var lastFetchSuccessAt: Long = 0L

    const val MODID = "bedwars_levelhead"
    const val VERSION = "8.3.0"
    private const val MODRINTH_PROJECT_SLUG = "bedwars-level-head"
    private const val MODRINTH_MOD_PAGE = "https://modrinth.com/mod/$MODRINTH_PROJECT_SLUG"
    private const val MODRINTH_API_BASE = "https://api.modrinth.com/v2"
    private const val TARGET_MC_VERSION = "1.8.9"
    private const val TARGET_LOADER = "forge"
    private const val MAX_STATS_CACHE_ENTRIES = 500

    private val minecraft: Minecraft
        get() = Minecraft.getMinecraft()

    fun isOnHypixel(): Boolean {
        if (minecraft.isSingleplayer) {
            return false
        }
        val serverIp = minecraft.currentServerData?.serverIP ?: return false
        val normalized = serverIp.lowercase(Locale.ROOT)
        return normalized.contains("hypixel")
    }

    fun sendChat(message: String) {
        val formatted = "${ChatColor.AQUA}[Levelhead] ${ChatColor.RESET}$message"
        minecraft.addScheduledTask {
            minecraft.thePlayer?.addChatMessage(ChatComponentText(formatted))
        }
    }

    private fun scheduleUpdateCheck() {
        if (!updateCheckScheduled.compareAndSet(false, true)) {
            return
        }
        scope.launch {
            try {
                val request = Request.Builder()
                    .url(buildModrinthVersionUrl())
                    .header("User-Agent", "Levelhead/$VERSION")
                    .build()
                okHttpClient.newCall(request).execute().use { response ->
                    if (!response.isSuccessful) {
                        logger.debug("Modrinth update check failed with status {}", response.code())
                        return@use
                    }
                    val body = response.body()?.string()?.takeIf { it.isNotBlank() } ?: return@use
                    val json = kotlin.runCatching { jsonParser.parse(body) }.getOrNull() ?: return@use
                    if (!json.isJsonArray) {
                        logger.debug("Unexpected Modrinth response: not an array")
                        return@use
                    }
                    val versions = json.asJsonArray.asSequence()
                        .filter { it.isJsonObject }
                        .map { it.asJsonObject }
                    val latest = versions.firstOrNull { obj ->
                        val type = obj.get("version_type")?.asString?.lowercase(Locale.ROOT)
                        type == null || type == "release"
                    } ?: versions.firstOrNull() ?: return@use
                    val latestVersion = latest.get("version_number")?.asString ?: return@use
                    if (latestVersion == VERSION) {
                        return@use
                    }
                    val downloadUrl = "$MODRINTH_MOD_PAGE/versions"
                    sendChat(
                        "${ChatColor.YELLOW}A new update is available: ${ChatColor.GOLD}$latestVersion${ChatColor.YELLOW} (current ${ChatColor.GOLD}$VERSION${ChatColor.YELLOW}). ${ChatColor.GREEN}Download: ${ChatColor.AQUA}$downloadUrl"
                    )
                }
            } catch (throwable: Throwable) {
                logger.debug("Failed to check for updates on Modrinth", throwable)
            }
        }
    }

    private fun buildModrinthVersionUrl(): String {
        val encodedVersions = "[\"$TARGET_MC_VERSION\"]".encodeForUrl()
        val encodedLoaders = "[\"$TARGET_LOADER\"]".encodeForUrl()
        return "$MODRINTH_API_BASE/project/$MODRINTH_PROJECT_SLUG/version?game_versions=$encodedVersions&loaders=$encodedLoaders"
    }

    private fun String.encodeForUrl(): String =
        URLEncoder.encode(this, StandardCharsets.UTF_8.name()).replace("+", "%20")

    private fun showWelcomeMessageIfNeeded() {
        if (LevelheadConfig.welcomeMessageShown) {
            return
        }
        LevelheadConfig.markWelcomeMessageShown()
        sendChat("${ChatColor.GREEN}Thanks for installing Levelhead!")
        sendChat(
            "${ChatColor.YELLOW}The mod is in alpha, so bugs may occur. ${ChatColor.GOLD}Report issues on GitHub or message ${ChatColor.AQUA}beenyiscool${ChatColor.GOLD} on Discord to request new features."
        )
    }

    fun preInit(@Suppress("UNUSED_PARAMETER") event: FMLPreInitializationEvent) {
        LevelheadConfig
    }

    fun postInit(@Suppress("UNUSED_PARAMETER") event: FMLPostInitializationEvent) {
        MinecraftForge.EVENT_BUS.register(AboveHeadRender)
        MinecraftForge.EVENT_BUS.register(BedwarsModeDetector)
        MinecraftForge.EVENT_BUS.register(this)
        CommandManager.INSTANCE.registerCommand(LevelheadCommand())
        scheduleUpdateCheck()
        showWelcomeMessageIfNeeded()
    }

    @SubscribeEvent
    fun joinServer(@Suppress("UNUSED_PARAMETER") event: FMLNetworkEvent.ClientConnectedToServerEvent) {
        BedwarsFetcher.resetWarnings()
        resetWorldScope()
        rateLimiter.resetState()
        displayManager.clearCachesWithoutRefetch()
        resetFetchTimestamps()
        worldScope.launch { displayManager.requestAllDisplays() }
    }

    @SubscribeEvent
    fun playerJoin(event: EntityJoinWorldEvent) {
        if (event.entity is EntityPlayerSP) {
            resetWorldScope()
            rateLimiter.resetState()
            clearCachedStats()
            resetFetchTimestamps()
            displayManager.joinWorld(resetDetector = true)
        } else if (event.entity is EntityPlayer) {
            displayManager.playerJoin(event.entity as EntityPlayer)
        }
    }

    fun fetchBatch(requests: List<LevelheadRequest>): Job {
        return worldScope.launch {
            if (!BedwarsModeDetector.shouldRequestData()) return@launch
            if (requests.isEmpty()) return@launch

            val now = System.currentTimeMillis()
            val pending = mutableListOf<PendingStatsRequest>()

            requests
                .groupBy { it.uuid }
                .forEach { (trimmedUuid, groupedRequests) ->
                    val uuid = trimmedUuid.dashUUID ?: return@forEach
                    val displays = groupedRequests.map { it.display }.toSet()
                    val cached = statsCache[uuid]
                    when {
                        cached == null -> {
                            statsCacheMetrics.recordMiss(CacheMissReason.COLD)
                            pending += PendingStatsRequest(trimmedUuid, uuid, groupedRequests, displays, cached, false)
                        }
                        cached.isExpired(LevelheadConfig.starCacheTtl, now) -> {
                            statsCacheMetrics.recordMiss(CacheMissReason.EXPIRED)
                            registerDisplaysForRefresh(uuid, displays)
                            applyStatsToRequests(uuid, groupedRequests, cached)
                            pending += PendingStatsRequest(trimmedUuid, uuid, groupedRequests, displays, cached, true)
                        }
                        else -> applyStatsToRequests(uuid, groupedRequests, cached)
                    }
                }

            if (pending.isEmpty()) return@launch

            val remaining = pending.toMutableList()

            if (LevelheadConfig.proxyEnabled) {
                // 1. Identify requests that are not currently being fetched by another thread
                val proxyCandidates = remaining.filter { inFlightStatsRequests.containsKey(it.uuid).not() }

                // 2. Immediately "claim" these UUIDs by putting a placeholder into the map.
                // This prevents the race condition where a second thread sees them as free and sends a duplicate request.
                val batchLocks = proxyCandidates.associate { entry ->
                    val deferred = CompletableDeferred<CachedBedwarsStats?>()
                    // Use putIfAbsent to be thread-safe. If it returns null, we successfully claimed the lock.
                    val existing = inFlightStatsRequests.putIfAbsent(entry.uuid, deferred)
                    
                    if (entry.registerForRefresh && entry.displays.isNotEmpty()) {
                        registerDisplaysForRefresh(entry.uuid, entry.displays)
                    }

                    // If existing is null, we own the lock. If not, someone else beat us to it (ignore this one).
                    entry.uuid to (if (existing == null) deferred else null)
                }.filterValues { it != null }.mapValues { it.value!! }

                // Only proceed with UUIDs we successfully locked
                val lockedEligible = proxyCandidates.filter { batchLocks.containsKey(it.uuid) }

                lockedEligible
                    .map { it.uuid }
                    .chunked(20)
                    .forEach { chunk ->
                        lastFetchAttemptAt = System.currentTimeMillis()
                        
                        // Perform the network request
                        val results = BedwarsFetcher.fetchBatchFromProxy(chunk)
                        
                        chunk.forEach { uuid ->
                            val result = results[uuid]
                            val entry = remaining.find { it.uuid == uuid }
                            val lock = batchLocks[uuid]

                            if (entry == null || result == null) {
                                // Something went wrong, release lock with null so waiters stop waiting
                                lock?.complete(null)
                                inFlightStatsRequests.remove(uuid)
                                return@forEach
                            }

                            when (result) {
                                is BedwarsFetcher.FetchResult.Success -> {
                                    lastFetchSuccessAt = System.currentTimeMillis()
                                    val cachedEntry = buildCachedStats(result.payload)
                                    handleStatsUpdate(uuid, cachedEntry)
                                    applyStatsToRequests(uuid, entry.requests, cachedEntry)
                                    remaining.remove(entry)

                                    // SUCCESS: Complete the lock with data and remove from inFlight map
                                    lock?.complete(cachedEntry)
                                    inFlightStatsRequests.remove(uuid)
                                }
                                else -> {
                                    if (entry.registerForRefresh && entry.displays.isNotEmpty()) {
                                        registerDisplaysForRefresh(entry.uuid, entry.displays)
                                    }

                                    // Check if we should remove from 'remaining' (to skip fallback)
                                    val proxyErrorReason = when (result) {
                                        is BedwarsFetcher.FetchResult.TemporaryError -> result.reason
                                        is BedwarsFetcher.FetchResult.PermanentError -> result.reason
                                        else -> null
                                    }

                                    val shouldSkipFallback = LevelheadConfig.proxyEnabled &&
                                            entry.cached != null &&
                                            proxyErrorReason != null &&
                                            (proxyErrorReason.startsWith("PROXY_") || proxyErrorReason.startsWith("HTTP_"))

                                    if (shouldSkipFallback) {
                                        remaining.remove(entry)
                                        // Completed, but failed.
                                        lock?.complete(null)
                                    } else {
                                        // Fallback required. 
                                        // We complete with null so any *other* threads waiting on this batch stop waiting.
                                        // We remove from inFlightStatsRequests so the fallback logic (ensureStatsFetch) can create a NEW individual request.
                                        lock?.complete(null)
                                    }
                                    inFlightStatsRequests.remove(uuid)
                                }
                            }
                        }
                    }
            }

            remaining.forEach { entry ->
                val fetched = ensureStatsFetch(entry.uuid, entry.cached, entry.displays, entry.registerForRefresh).await()
                applyStatsToRequests(entry.uuid, entry.requests, fetched)
            }
        }
    }

    fun clearCachedStats() {
        statsCache.clear()
        pendingDisplayRefreshes.clear()
        inFlightStatsRequests.values.forEach { it.cancel() }
        inFlightStatsRequests.clear()
        statsCacheMetrics.reset()
    }

    internal fun onRateLimiterBlocked(metrics: Metrics) {
        if (rateLimiterNotified.compareAndSet(false, true)) {
            val resetText = formatCooldownDuration(metrics.resetIn)
            sendChat(
                "${ChatColor.YELLOW}BedWars stats cooling down. ${ChatColor.GOLD}${metrics.remaining} requests remaining${ChatColor.YELLOW}. Reset in $resetText."
            )
        }
    }
    internal fun resetRateLimiterNotification() {
        rateLimiterNotified.set(false)
    }

    internal fun onServerRetryAfter(duration: Duration) {
        if (duration.isZero || duration.isNegative) return
        val newDeadline = System.currentTimeMillis() + duration.toMillis()
        while (true) {
            val current = serverCooldownNotifiedUntil.get()
            if (newDeadline <= current) {
                return
            }
            if (serverCooldownNotifiedUntil.compareAndSet(current, newDeadline)) {
                val formatted = formatCooldownDuration(duration)
                sendChat(
                    "${ChatColor.YELLOW}Proxy asked us to pause BedWars stat requests for ${ChatColor.GOLD}$formatted${ChatColor.YELLOW}."
                )
                return
            }
        }
    }
    internal fun resetServerCooldownNotification() {
        serverCooldownNotifiedUntil.set(0L)
    }

    private fun ensureStatsFetch(
        uuid: UUID,
        cached: CachedBedwarsStats?,
        displays: Collection<LevelheadDisplay>,
        registerForRefresh: Boolean
    ): Deferred<CachedBedwarsStats?> {
        if (registerForRefresh && displays.isNotEmpty()) {
            registerDisplaysForRefresh(uuid, displays)
        }

        val existing = inFlightStatsRequests[uuid]
        if (existing != null) {
            if (registerForRefresh && displays.isNotEmpty()) {
                registerDisplaysForRefresh(uuid, displays)
            }
            return existing
        }

        val deferred = worldScope.async {
            starFetchSemaphore.withPermit {
                if (registerForRefresh && cached != null) {
                    delay(Random.nextLong(50L, 201L))
                }
                try {
                    lastFetchAttemptAt = System.currentTimeMillis()
                    rateLimiter.consume()
                    when (val result = BedwarsFetcher.fetchPlayer(uuid, cached?.fetchedAt)) {
                        is BedwarsFetcher.FetchResult.Success -> {
                            lastFetchSuccessAt = System.currentTimeMillis()
                            val entry = buildCachedStats(result.payload)
                            handleStatsUpdate(uuid, entry)
                            entry
                        }
                        BedwarsFetcher.FetchResult.NotModified -> {
                            lastFetchSuccessAt = System.currentTimeMillis()
                            val refreshed = cached?.copy(fetchedAt = System.currentTimeMillis())
                            refreshed?.let { handleStatsUpdate(uuid, it) }
                            refreshed
                        }
                        is BedwarsFetcher.FetchResult.TemporaryError -> {
                            handleStatsUpdate(uuid, cached)
                            null
                        }
                        is BedwarsFetcher.FetchResult.PermanentError -> {
                            handleStatsUpdate(uuid, cached)
                            null
                        }
                    }
                } catch (throwable: Throwable) {
                    handleStatsUpdate(uuid, null)
                    null
                }
            }
        }

        val previous = inFlightStatsRequests.putIfAbsent(uuid, deferred)
        if (previous != null) {
            deferred.cancel()
            if (registerForRefresh && displays.isNotEmpty()) {
                registerDisplaysForRefresh(uuid, displays)
            }
            return previous
        }

        deferred.invokeOnCompletion { inFlightStatsRequests.remove(uuid, deferred) }
        return deferred
    }

    private fun buildCachedStats(payload: JsonObject): CachedBedwarsStats {
        val experience = BedwarsStar.extractExperience(payload)
        val star = experience?.let { BedwarsStar.calculateStar(it) }
        val fkdr = BedwarsFetcher.parseBedwarsFkdr(payload)
        val winstreak = BedwarsFetcher.parseBedwarsWinstreak(payload)
        val fetchedAt = System.currentTimeMillis()
        return CachedBedwarsStats(star, experience, fkdr, winstreak, fetchedAt)
    }

    private fun resetWorldScope() {
        synchronized(worldScopeLock) {
            worldJob.cancel()
            worldJob = SupervisorJob(modJob)
            worldScope = CoroutineScope(worldJob + Dispatchers.IO)
        }
    }

    private fun resetFetchTimestamps() {
        lastFetchAttemptAt = 0L
        lastFetchSuccessAt = 0L
    }

    fun resetWorldCoroutines() {
        resetWorldScope()
        resetFetchTimestamps()
    }

    fun statusSnapshot(): StatusSnapshot {
        val now = System.currentTimeMillis()
        val attemptAge = lastFetchAttemptAt.takeIf { it > 0 }?.let { now - it }
        val successAge = lastFetchSuccessAt.takeIf { it > 0 }?.let { now - it }
        val rateMetrics = rateLimiter.metricsSnapshot()
        val statsCacheSnapshot = statsCacheMetrics.snapshot()
        return StatusSnapshot(
            proxyEnabled = LevelheadConfig.proxyEnabled,
            proxyConfigured = LevelheadConfig.proxyEnabled && LevelheadConfig.proxyBaseUrl.isNotBlank(),
            cacheSize = statsCache.size,
            lastAttemptAgeMillis = attemptAge,
            lastSuccessAgeMillis = successAge,
            rateLimitRemaining = rateMetrics.remaining,
            rateLimitResetMillis = rateMetrics.resetIn.toMillis().coerceAtLeast(0),
            starCacheTtlMinutes = LevelheadConfig.starCacheTtlMinutes,
            cacheMissesCold = statsCacheSnapshot.cold,
            cacheMissesExpired = statsCacheSnapshot.expired,
            serverCooldownMillis = rateMetrics.serverCooldown?.toMillis()?.coerceAtLeast(0)
        )
    }

    private fun registerDisplaysForRefresh(uuid: UUID, displays: Collection<LevelheadDisplay>) {
        if (displays.isEmpty()) return
        pendingDisplayRefreshes.compute(uuid) { _, existing ->
            val set = existing ?: ConcurrentHashMap.newKeySet<LevelheadDisplay>()
            set.addAll(displays)
            set
        }
    }

    private fun handleStatsUpdate(uuid: UUID, entry: CachedBedwarsStats?) {
        if (entry != null) {
            statsCache[uuid] = entry
            trimStatsCache()
        }
        val listeners = pendingDisplayRefreshes.remove(uuid) ?: return
        if (entry != null) {
            listeners
                .filter { it.config.enabled && it.cache.containsKey(uuid) }
                .forEach { display -> updateDisplayCache(display, uuid, entry) }
        }
    }

    private fun trimStatsCache(now: Long = System.currentTimeMillis()) {
        val expiredKeys = statsCache
            .filterValues { it.isExpired(LevelheadConfig.starCacheTtl, now) }
            .keys
        expiredKeys.forEach { statsCache.remove(it) }

        if (statsCache.size <= MAX_STATS_CACHE_ENTRIES) return

        val overflow = statsCache.size - MAX_STATS_CACHE_ENTRIES
        if (overflow <= 0) return

        statsCache.entries
            .sortedBy { it.value.fetchedAt }
            .take(overflow)
            .forEach { (key, _) -> statsCache.remove(key) }
    }

    private fun applyStatsToRequests(
        uuid: UUID,
        requests: List<LevelheadRequest>,
        starData: CachedBedwarsStats?
    ) {
        requests
            .filter { it.type == BedwarsModeDetector.BEDWARS_STAR_TYPE }
            .forEach { req -> updateDisplayCache(req.display, uuid, starData) }
    }

    private fun updateDisplayCache(display: LevelheadDisplay, uuid: UUID, starData: CachedBedwarsStats?) {
        if (!display.config.enabled) return
        val starValue = starData?.star
        val starString = starValue?.let { "$it✪" } ?: "?"
        val fkdrString = starData?.fkdr?.let { String.format(Locale.ROOT, "%.2f", it) } ?: "?"
        val winstreakString = starData?.winstreak?.toString() ?: "?"
        val footerTemplate = display.config.footerString?.takeIf { it.isNotBlank() } ?: "%star%"
        var footerValue = footerTemplate
        if (footerValue.contains("%star%", ignoreCase = true)) {
            footerValue = footerValue.replace("%star%", starString, true)
        }
        if (footerValue.contains("%fkdr%", ignoreCase = true)) {
            footerValue = footerValue.replace("%fkdr%", fkdrString, true)
        }
        if (footerValue.contains("%ws%", ignoreCase = true)) {
            footerValue = footerValue.replace("%ws%", winstreakString, true)
        }
        val baseStyle = starValue?.let { BedwarsStar.styleForStar(it) }
            ?: BedwarsStar.PrestigeStyle(display.config.footerColor, false)
        val style = baseStyle.copy(chroma = false)
        val tag = LevelheadTag.build(uuid) {
            header {
                value = "${display.config.headerString}: "
                color = display.config.headerColor
                chroma = false
            }
            footer {
                value = footerValue
                color = style.color
                chroma = style.chroma
            }
        }
        display.cache[uuid] = tag
    }

    private fun formatCooldownDuration(duration: Duration): String {
        val totalSeconds = duration.seconds.coerceAtLeast(0)
        val minutes = totalSeconds / 60
        val seconds = totalSeconds % 60
        return String.format(Locale.ROOT, "%d:%02d", minutes, seconds)
    }

    data class LevelheadRequest(val uuid: String, val display: LevelheadDisplay, val allowOverride: Boolean, val type: String = display.config.type)

    private data class PendingStatsRequest(
        val trimmedUuid: String,
        val uuid: UUID,
        val requests: List<LevelheadRequest>,
        val displays: Set<LevelheadDisplay>,
        val cached: CachedBedwarsStats?,
        val registerForRefresh: Boolean
    )

    data class CachedBedwarsStats(
        val star: Int?,
        val experience: Long?,
        val fkdr: Double?,
        val winstreak: Int?,
        val fetchedAt: Long
    ) {
        fun isExpired(ttl: Duration, now: Long = System.currentTimeMillis()): Boolean {
            return now - fetchedAt >= ttl.toMillis()
        }
    }

    data class StatusSnapshot(
        val proxyEnabled: Boolean,
        val proxyConfigured: Boolean,
        val cacheSize: Int,
        val lastAttemptAgeMillis: Long?,
        val lastSuccessAgeMillis: Long?,
        val rateLimitRemaining: Int,
        val rateLimitResetMillis: Long,
        val starCacheTtlMinutes: Int,
        val cacheMissesCold: Long,
        val cacheMissesExpired: Long,
        val serverCooldownMillis: Long?
    )

    private enum class CacheMissReason { COLD, EXPIRED }
// trigger rebuild
    private class StatsCacheMetrics {
        private val coldMisses = AtomicLong(0L)
        private val expiredMisses = AtomicLong(0L)

        fun recordMiss(reason: CacheMissReason) {
            when (reason) {
                CacheMissReason.COLD -> coldMisses.incrementAndGet()
                CacheMissReason.EXPIRED -> expiredMisses.incrementAndGet()
            }
        }

        fun reset() {
            coldMisses.set(0L)
            expiredMisses.set(0L)
        }

        fun snapshot(): StatsCacheSnapshot {
            return StatsCacheSnapshot(coldMisses.get(), expiredMisses.get())
        }
    }

    data class StatsCacheSnapshot(val cold: Long, val expired: Long)
}
