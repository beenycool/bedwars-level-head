package club.sk1er.mods.levelhead

import cc.polyfrost.oneconfig.utils.commands.CommandManager
import club.sk1er.mods.levelhead.bedwars.BedwarsFetcher
import club.sk1er.mods.levelhead.bedwars.FetchResult
import club.sk1er.mods.levelhead.commands.LevelheadCommand
import club.sk1er.mods.levelhead.commands.WhoisCommand
import club.sk1er.mods.levelhead.config.LevelheadConfig
import club.sk1er.mods.levelhead.core.DisplayManager
import club.sk1er.mods.levelhead.core.GameMode
import club.sk1er.mods.levelhead.core.GameStats
import club.sk1er.mods.levelhead.core.ModeManager
import club.sk1er.mods.levelhead.core.RateLimiter
import club.sk1er.mods.levelhead.core.RateLimiterMetrics
import club.sk1er.mods.levelhead.core.StatsFetcher
import club.sk1er.mods.levelhead.core.StatsFormatter
import club.sk1er.mods.levelhead.core.dashUUID
import club.sk1er.mods.levelhead.core.trimmed
import club.sk1er.mods.levelhead.display.LevelheadDisplay
import club.sk1er.mods.levelhead.duels.DuelsModeDetector
import club.sk1er.mods.levelhead.render.AboveHeadRender
import club.sk1er.mods.levelhead.skywars.SkyWarsModeDetector
import com.google.gson.Gson
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
import net.minecraftforge.fml.common.gameevent.TickEvent
import net.minecraftforge.fml.common.network.FMLNetworkEvent
import okhttp3.Dns
import okhttp3.OkHttpClient
import okhttp3.Request
import org.apache.logging.log4j.LogManager
import org.apache.logging.log4j.Logger
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
import club.sk1er.mods.levelhead.core.BedwarsModeDetector

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
    val rateLimiter: RateLimiter = RateLimiter(150, Duration.ofMinutes(5), onBlocked = ::onRateLimiterBlocked, onReset = ::resetRateLimiterNotification)

    private val statsCache: ConcurrentHashMap<StatsCacheKey, GameStats> = ConcurrentHashMap()
    private val inFlightStatsRequests: ConcurrentHashMap<StatsCacheKey, Deferred<GameStats?>> = ConcurrentHashMap()
    private val pendingDisplayRefreshes: ConcurrentHashMap<StatsCacheKey, MutableSet<LevelheadDisplay>> = ConcurrentHashMap()
    private val starFetchSemaphore: Semaphore = Semaphore(6)
    private val rateLimiterNotified = AtomicBoolean(false)
    private val statsCacheMetrics = StatsCacheMetrics()
    private val serverCooldownNotifiedUntil = AtomicLong(0L)
    private val updateCheckScheduled = AtomicBoolean(false)
    private val lastServerCooldownNotificationAt = AtomicLong(0L)
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
        MinecraftForge.EVENT_BUS.register(DuelsModeDetector)
        MinecraftForge.EVENT_BUS.register(SkyWarsModeDetector)
        MinecraftForge.EVENT_BUS.register(this)
        CommandManager.INSTANCE.registerCommand(LevelheadCommand())
        CommandManager.INSTANCE.registerCommand(WhoisCommand())
        scheduleUpdateCheck()
        showWelcomeMessageIfNeeded()
    }

    @SubscribeEvent
    fun joinServer(@Suppress("UNUSED_PARAMETER") event: FMLNetworkEvent.ClientConnectedToServerEvent) {
        StatsFetcher.resetWarnings()
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
            ModeManager.onWorldJoin()
            displayManager.joinWorld(resetDetector = true)
        } else if (event.entity is EntityPlayer) {
            displayManager.playerJoin(event.entity as EntityPlayer)
        }
    }

    @SubscribeEvent
    fun onClientTick(event: TickEvent.ClientTickEvent) {
        if (event.phase != TickEvent.Phase.END) return
        LevelheadConfig.syncUiAndRuntimeConfig()
        displayManager.tick()
    }

    fun fetchBatch(requests: List<LevelheadRequest>): Job {
        return worldScope.launch {
            if (!Levelhead.isOnHypixel()) return@launch
            if (requests.isEmpty()) return@launch

            val now = System.currentTimeMillis()
            val pending = mutableListOf<PendingStatsRequest>()

            requests
                .groupBy { it.uuid }
                .forEach { (trimmedUuid, groupedRequests) ->
                    val uuid = trimmedUuid.dashUUID ?: return@forEach
                    groupedRequests
                        .groupBy { resolveGameMode(it.type) }
                        .forEach { (gameMode, modeRequests) ->
                            val displays = modeRequests.map { it.display }.toSet()
                            val cacheKey = StatsCacheKey(uuid, gameMode)
                            val cached = statsCache[cacheKey]
                            when {
                                cached == null -> {
                                    statsCacheMetrics.recordMiss(CacheMissReason.COLD)
                                    pending += PendingStatsRequest(
                                        trimmedUuid,
                                        uuid,
                                        gameMode,
                                        modeRequests,
                                        displays,
                                        cached,
                                        false
                                    )
                                }
                                cached.isExpired(LevelheadConfig.starCacheTtl, now) -> {
                                    statsCacheMetrics.recordMiss(CacheMissReason.EXPIRED)
                                    registerDisplaysForRefresh(cacheKey, displays)
                                    applyStatsToRequests(uuid, modeRequests, cached)
                                    pending += PendingStatsRequest(
                                        trimmedUuid,
                                        uuid,
                                        gameMode,
                                        modeRequests,
                                        displays,
                                        cached,
                                        true
                                    )
                                }
                                else -> applyStatsToRequests(uuid, modeRequests, cached)
                            }
                        }
                }

            if (pending.isEmpty()) return@launch
            if (!ModeManager.shouldRequestData()) return@launch

            val remaining = pending.toMutableList()

            if (LevelheadConfig.proxyEnabled) {
                val proxyCandidates = remaining
                    .filter { inFlightStatsRequests.containsKey(it.cacheKey).not() }
                if (proxyCandidates.isNotEmpty()) {
                    val batchLocks = proxyCandidates.associate { entry ->
                        val deferred = CompletableDeferred<GameStats?>()
                        val existing = inFlightStatsRequests.putIfAbsent(entry.cacheKey, deferred)

                        if (entry.registerForRefresh && entry.displays.isNotEmpty()) {
                            registerDisplaysForRefresh(entry.cacheKey, entry.displays)
                        }

                        entry.cacheKey to (if (existing == null) deferred else null)
                    }.filterValues { it != null }.mapValues { it.value!! }

                    val lockedEligible = proxyCandidates.filter { batchLocks.containsKey(it.cacheKey) }
                    val entriesByUuid = lockedEligible.groupBy { it.uuid }

                    lockedEligible
                        .map { it.uuid }
                        .distinct()
                        .chunked(20)
                        .forEach { chunk ->
                            lastFetchAttemptAt = System.currentTimeMillis()
                            
                            val results = club.sk1er.mods.levelhead.bedwars.ProxyClient.fetchBatch(chunk)
                            
                            chunk.forEach uuidLoop@{ uuid ->
                                val result = results[uuid]
                                val entries = entriesByUuid[uuid].orEmpty()

                                if (entries.isEmpty() || result == null) {
                                    entries.forEach { entry ->
                                        batchLocks[entry.cacheKey]?.complete(null)
                                        inFlightStatsRequests.remove(entry.cacheKey)
                                    }
                                    return@uuidLoop
                                }

                                when (result) {
                                    is FetchResult.Success -> {
                                        lastFetchSuccessAt = System.currentTimeMillis()
                                        entries.forEach { entry ->
                                            val cachedEntry = StatsFetcher.buildGameStats(
                                                result.payload,
                                                entry.gameMode,
                                                result.etag
                                            )
                                            
                                            if (cachedEntry != null) {
                                                handleStatsUpdate(entry.cacheKey, cachedEntry)
                                                applyStatsToRequests(uuid, entry.requests, cachedEntry)
                                                remaining.remove(entry)
                                                batchLocks[entry.cacheKey]?.complete(cachedEntry)
                                                inFlightStatsRequests.remove(entry.cacheKey)
                                            } else {
                                                // Data missing for this mode in the proxy response.
                                                // Complete the lock with null so it can fall back to individual fetch (Hypixel)
                                                batchLocks[entry.cacheKey]?.complete(null)
                                                inFlightStatsRequests.remove(entry.cacheKey)
                                            }
                                        }
                                    }
                                    else -> {
                                        val proxyErrorReason = when (result) {
                                            is FetchResult.TemporaryError -> result.reason
                                            is FetchResult.PermanentError -> result.reason
                                            else -> null
                                        }

                                        entries.forEach { entry ->
                                            if (entry.registerForRefresh && entry.displays.isNotEmpty()) {
                                                registerDisplaysForRefresh(entry.cacheKey, entry.displays)
                                            }

                                            val shouldSkipFallback = LevelheadConfig.proxyEnabled &&
                                                    entry.cached != null &&
                                                    proxyErrorReason != null &&
                                                    (proxyErrorReason.startsWith("PROXY_") || proxyErrorReason.startsWith("HTTP_"))

                                            if (shouldSkipFallback) {
                                                remaining.remove(entry)
                                            }
                                            batchLocks[entry.cacheKey]?.complete(null)
                                            inFlightStatsRequests.remove(entry.cacheKey)
                                        }
                                    }
                                }
                            }
                        }
                }
            }

            remaining.forEach { entry ->
                val fetched = ensureStatsFetch(
                    entry.cacheKey,
                    entry.cached,
                    entry.displays,
                    entry.registerForRefresh
                ).await()
                applyStatsToRequests(entry.uuid, entry.requests, fetched)
            }
        }
    }

    fun getCachedStats(uuid: UUID): GameStats? {
        val gameMode = ModeManager.getActiveGameMode() ?: GameMode.BEDWARS
        return getCachedStats(uuid, gameMode)
    }

    fun getCachedStats(uuid: UUID, gameMode: GameMode): GameStats? {
        return statsCache[StatsCacheKey(uuid, gameMode)]
    }

    fun clearCachedStats() {
        statsCache.clear()
        pendingDisplayRefreshes.clear()
        inFlightStatsRequests.values.forEach { it.cancel() }
        inFlightStatsRequests.clear()
        statsCacheMetrics.reset()
    }

    internal fun onRateLimiterBlocked(metrics: RateLimiterMetrics) {
        if (rateLimiterNotified.compareAndSet(false, true)) {
            val resetText = formatCooldownDuration(metrics.resetIn)
            sendChat(
                "${ChatColor.YELLOW}Stats cooling down. ${ChatColor.GOLD}${metrics.remaining} requests remaining${ChatColor.YELLOW}. Reset in $resetText."
            )
        }
    }
    internal fun resetRateLimiterNotification() {
        rateLimiterNotified.set(false)
    }

    internal fun onServerRetryAfter(duration: Duration) {
        if (duration.isZero || duration.isNegative) return
        val now = System.currentTimeMillis()
        val minNotifyIntervalMs = 20_000L
        val lastNotified = lastServerCooldownNotificationAt.get()
        if (now - lastNotified < minNotifyIntervalMs) {
            return
        }
        val newDeadline = now + duration.toMillis()
        while (true) {
            val current = serverCooldownNotifiedUntil.get()
            if (newDeadline <= current) {
                return
            }
            if (serverCooldownNotifiedUntil.compareAndSet(current, newDeadline)) {
                lastServerCooldownNotificationAt.set(now)
                val formatted = formatCooldownDuration(duration)
                sendChat(
                    "${ChatColor.YELLOW}Proxy asked us to pause stat requests for ${ChatColor.GOLD}$formatted${ChatColor.YELLOW}."
                )
                return
            }
        }
    }
    internal fun resetServerCooldownNotification() {
        serverCooldownNotifiedUntil.set(0L)
        lastServerCooldownNotificationAt.set(0L)
    }

    private fun ensureStatsFetch(
        cacheKey: StatsCacheKey,
        cached: GameStats?,
        displays: Collection<LevelheadDisplay>,
        registerForRefresh: Boolean
    ): Deferred<GameStats?> {
        if (registerForRefresh && displays.isNotEmpty()) {
            registerDisplaysForRefresh(cacheKey, displays)
        }

        val existing = inFlightStatsRequests[cacheKey]
        if (existing != null) {
            if (registerForRefresh && displays.isNotEmpty()) {
                registerDisplaysForRefresh(cacheKey, displays)
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
                    val gameMode = cacheKey.gameMode
                    when (val result = StatsFetcher.fetchPlayer(cacheKey.uuid, gameMode, cached?.fetchedAt, cached?.etag)) {
                        is FetchResult.Success -> {
                            lastFetchSuccessAt = System.currentTimeMillis()
                            val entry = StatsFetcher.buildGameStats(result.payload, gameMode, result.etag)
                            handleStatsUpdate(cacheKey, entry)
                            entry
                        }
                        FetchResult.NotModified -> {
                            lastFetchSuccessAt = System.currentTimeMillis()
                            val refreshed = when (cached) {
                                is GameStats.Bedwars -> cached.copy(fetchedAt = System.currentTimeMillis())
                                is GameStats.Duels -> cached.copy(fetchedAt = System.currentTimeMillis())
                                is GameStats.SkyWars -> cached.copy(fetchedAt = System.currentTimeMillis())
                                null -> null
                            }
                            refreshed?.let { handleStatsUpdate(cacheKey, it) }
                            refreshed
                        }
                        is FetchResult.TemporaryError -> {
                            handleStatsUpdate(cacheKey, cached)
                            null
                        }
                        is FetchResult.PermanentError -> {
                            handleStatsUpdate(cacheKey, cached)
                            null
                        }
                    }
                } catch (throwable: Throwable) {
                    logger.debug(
                        "Failed to fetch stats for {} ({})",
                        cacheKey.uuid,
                        cacheKey.gameMode,
                        throwable
                    )
                    handleStatsUpdate(cacheKey, null)
                    null
                }
            }
        }

        val previous = inFlightStatsRequests.putIfAbsent(cacheKey, deferred)
        if (previous != null) {
            deferred.cancel()
            if (registerForRefresh && displays.isNotEmpty()) {
                registerDisplaysForRefresh(cacheKey, displays)
            }
            return previous
        }

        deferred.invokeOnCompletion { inFlightStatsRequests.remove(cacheKey, deferred) }
        return deferred
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

    private fun registerDisplaysForRefresh(cacheKey: StatsCacheKey, displays: Collection<LevelheadDisplay>) {
        if (displays.isEmpty()) return
        pendingDisplayRefreshes.compute(cacheKey) { _, existing ->
            val set = existing ?: ConcurrentHashMap.newKeySet<LevelheadDisplay>()
            set.addAll(displays)
            set
        }
    }

    private fun handleStatsUpdate(cacheKey: StatsCacheKey, entry: GameStats?) {
        if (entry != null) {
            statsCache[cacheKey] = entry
            trimStatsCache()
        }
        val listeners = pendingDisplayRefreshes.remove(cacheKey) ?: return
        if (entry != null) {
            listeners
                .filter { it.config.enabled && it.cache.containsKey(cacheKey.uuid) }
                .forEach { display -> updateDisplayCache(display, cacheKey.uuid, entry, cacheKey.gameMode) }
        }
    }

    private fun trimStatsCache(now: Long = System.currentTimeMillis()) {
        val expiredKeys = statsCache
            .filterValues { it.isExpired(LevelheadConfig.starCacheTtl, now) }
            .keys
        expiredKeys.forEach { statsCache.remove(it) }

        val maxCacheSize = displayManager.config.purgeSize
        if (statsCache.size <= maxCacheSize) return

        val entriesSnapshot = statsCache.entries.toList()
        val overflow = entriesSnapshot.size - maxCacheSize
        if (overflow <= 0) return

        entriesSnapshot
            .sortedBy { it.value.fetchedAt }
            .take(overflow)
            .forEach { statsCache.remove(it.key) }
    }

    private fun applyStatsToRequests(
        uuid: UUID,
        requests: List<LevelheadRequest>,
        stats: GameStats?
    ) {
        requests.forEach { req ->
            val gameMode = resolveGameMode(req.type)
            val matchingStats = statsForMode(stats, gameMode)
            updateDisplayCache(req.display, uuid, matchingStats, gameMode)
        }
    }

    private fun updateDisplayCache(display: LevelheadDisplay, uuid: UUID, stats: GameStats?, gameMode: GameMode) {
        if (!display.config.enabled) return
        val tag = StatsFormatter.formatTag(uuid, stats, display.config, gameMode)
        display.cache[uuid] = tag
    }

    private fun resolveGameMode(typeId: String): GameMode {
        return GameMode.fromTypeId(typeId) ?: GameMode.BEDWARS
    }

    private fun statsForMode(stats: GameStats?, gameMode: GameMode): GameStats? {
        return when (gameMode) {
            GameMode.BEDWARS -> stats as? GameStats.Bedwars
            GameMode.DUELS -> stats as? GameStats.Duels
            GameMode.SKYWARS -> stats as? GameStats.SkyWars
        }
    }

    private fun formatCooldownDuration(duration: Duration): String {
        val totalSeconds = duration.seconds.coerceAtLeast(0)
        val minutes = totalSeconds / 60
        val seconds = totalSeconds % 60
        return String.format(Locale.ROOT, "%d:%02d", minutes, seconds)
    }

    data class LevelheadRequest(val uuid: String, val display: LevelheadDisplay, val allowOverride: Boolean, val type: String = display.config.type)

    private data class StatsCacheKey(val uuid: UUID, val gameMode: GameMode)

    private data class PendingStatsRequest(
        val trimmedUuid: String,
        val uuid: UUID,
        val gameMode: GameMode,
        val requests: List<LevelheadRequest>,
        val displays: Set<LevelheadDisplay>,
        val cached: GameStats?,
        val registerForRefresh: Boolean,
        val cacheKey: StatsCacheKey = StatsCacheKey(uuid, gameMode)
    )

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
