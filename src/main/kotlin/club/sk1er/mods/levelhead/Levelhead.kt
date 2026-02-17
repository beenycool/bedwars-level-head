package club.sk1er.mods.levelhead

import cc.polyfrost.oneconfig.utils.commands.CommandManager
import club.sk1er.mods.levelhead.bedwars.BedwarsFetcher
import club.sk1er.mods.levelhead.commands.LevelheadCommand
import club.sk1er.mods.levelhead.commands.WhoisCommand
import club.sk1er.mods.levelhead.config.LevelheadConfig
import club.sk1er.mods.levelhead.core.DnsMode
import club.sk1er.mods.levelhead.core.DebugLogging
import club.sk1er.mods.levelhead.core.DebugLogging.formatAsHex
import club.sk1er.mods.levelhead.core.DebugLogging.maskForLogs
import club.sk1er.mods.levelhead.core.DebugLogging.truncateForLogs
import club.sk1er.mods.levelhead.core.DisplayManager
import club.sk1er.mods.levelhead.core.GameMode
import club.sk1er.mods.levelhead.core.GameStats
import club.sk1er.mods.levelhead.core.ModeManager
import club.sk1er.mods.levelhead.core.RateLimiter
import club.sk1er.mods.levelhead.core.RateLimiterMetrics
import club.sk1er.mods.levelhead.core.RequestCoordinator
import club.sk1er.mods.levelhead.core.StatsFormatter
import club.sk1er.mods.levelhead.core.StatsRepository
import club.sk1er.mods.levelhead.core.await
import club.sk1er.mods.levelhead.core.dashUUID
import club.sk1er.mods.levelhead.display.LevelheadDisplay
import club.sk1er.mods.levelhead.duels.DuelsModeDetector
import club.sk1er.mods.levelhead.render.AboveHeadRender
import club.sk1er.mods.levelhead.skywars.SkyWarsModeDetector
import com.google.gson.Gson
import com.google.gson.JsonParser
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
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
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong
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
    
    private val configurableDns = Dns { hostname ->
        val addresses = Dns.SYSTEM.lookup(hostname)
        when (LevelheadConfig.dnsMode) {
            DnsMode.IPV4_ONLY -> {
                val ipv4 = addresses.filterIsInstance<Inet4Address>()
                if (ipv4.isEmpty()) throw UnknownHostException("No IPv4 addresses for $hostname")
                ipv4
            }
            DnsMode.IPV4_FIRST -> {
                val (ipv4, other) = addresses.partition { it is Inet4Address }
                ipv4 + other
            }
            DnsMode.SYSTEM_DEFAULT -> addresses
        }
    }

    val okHttpClient: OkHttpClient = OkHttpClient.Builder()
        .dns(configurableDns)
        .connectTimeout(5, TimeUnit.SECONDS)
        .readTimeout(10, TimeUnit.SECONDS)
        .writeTimeout(10, TimeUnit.SECONDS)
        .callTimeout(15, TimeUnit.SECONDS)
        .build()
    val gson = Gson()

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
    val statsRepository: StatsRepository = StatsRepository(maxSizeProvider = { displayManager.config.purgeSize })
    val requestCoordinator: RequestCoordinator = RequestCoordinator(
        worldScopeProvider = { worldScope },
        repository = statsRepository,
        rateLimiter = rateLimiter,
        isOnHypixel = ::isOnHypixel,
        onTagUpdate = ::updateDisplayCache,
        logger = logger
    )

    private val rateLimiterNotified = AtomicBoolean(false)
    private val serverCooldownNotifiedUntil = AtomicLong(0L)
    private val updateCheckScheduled = AtomicBoolean(false)
    private val lastServerCooldownNotificationAt = AtomicLong(0L)

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
                okHttpClient.newCall(request).await().use { response ->
                    if (!response.isSuccessful) {
                        logger.debug("Modrinth update check failed with status {}", response.code())
                        return@use
                    }
                    val body = response.body()?.string()?.takeIf { it.isNotBlank() } ?: return@use
                    val json = kotlin.runCatching { JsonParser.parseString(body) }.getOrNull() ?: return@use
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
        club.sk1er.mods.levelhead.core.StatsFetcher.resetWarnings()
        resetWorldScope()
        rateLimiter.resetState()
        requestCoordinator.reset()
        displayManager.clearCachesWithoutRefetch()
        AboveHeadRender.clearRenderDebugState()
        worldScope.launch { displayManager.requestAllDisplays() }
    }

    @SubscribeEvent
    fun playerJoin(event: EntityJoinWorldEvent) {
        if (event.entity is EntityPlayerSP) {
            resetWorldScope()
            rateLimiter.resetState()
            clearCachedStats()
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
        return requestCoordinator.fetchBatch(requests)
    }

            val remaining = pending.toMutableList()

            if (LevelheadConfig.proxyEnabled) {
                val proxyCandidates = remaining
                    .filter { inFlightStatsRequests.containsKey(it.cacheKey).not() }
                if (proxyCandidates.isNotEmpty()) {
                    val batchLocks = proxyCandidates.mapNotNull { entry ->
                        val deferred = CompletableDeferred<GameStats?>()
                        val existing = inFlightStatsRequests.putIfAbsent(entry.cacheKey, deferred)

                        if (entry.registerForRefresh && entry.displays.isNotEmpty()) {
                            registerDisplaysForRefresh(entry.cacheKey, entry.displays)
                        }

                        if (existing == null) entry.cacheKey to deferred else null
                    }.toMap()

                    val lockedEligible = proxyCandidates.filter { batchLocks.containsKey(it.cacheKey) }
                    val entriesByUuid = lockedEligible.groupBy { it.uuid }

                    lockedEligible
                        .map { it.uuid }
                        .distinct()
                        .chunked(20)
                        .forEach { chunk ->
                            lastFetchAttemptAt = System.currentTimeMillis()
                            rateLimiter.consume()
                            
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
                                                DebugLogging.logRequestDebug {
                                                    "[LevelheadDebug][request] fallback skipped: uuid=${entry.uuid.maskForLogs()} mode=${entry.gameMode.name} reason=$proxyErrorReason"
                                                }
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
>>>>>>> origin/cleanup/null-safety-and-gson-modernization-9572016379926488654
    }

    fun getCachedStats(uuid: UUID): GameStats? {
        val gameMode = ModeManager.getActiveGameMode() ?: GameMode.BEDWARS
        return getCachedStats(uuid, gameMode)
    }

    fun getCachedStats(uuid: UUID, gameMode: GameMode): GameStats? {
        return statsRepository.get(uuid, gameMode)
    }

    fun clearCachedStats() {
        statsRepository.clear()
        statsRepository.resetMetrics()
        requestCoordinator.reset()
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

    private fun resetWorldScope() {
        synchronized(worldScopeLock) {
            worldJob.cancel()
            worldJob = SupervisorJob(modJob)
            worldScope = CoroutineScope(worldJob + Dispatchers.IO)
        }
    }

    fun resetWorldCoroutines() {
        resetWorldScope()
        requestCoordinator.resetFetchTimestamps()
    }

    fun statusSnapshot(): StatusSnapshot {
        val rateMetrics = rateLimiter.metricsSnapshot()
        val statsCacheSnapshot = statsRepository.metricsSnapshot()
        return StatusSnapshot(
            proxyEnabled = LevelheadConfig.proxyEnabled,
            proxyConfigured = LevelheadConfig.proxyEnabled && LevelheadConfig.proxyBaseUrl.isNotBlank(),
            cacheSize = statsRepository.size(),
            lastAttemptAgeMillis = requestCoordinator.lastAttemptAgeMillis,
            lastSuccessAgeMillis = requestCoordinator.lastSuccessAgeMillis,
            rateLimitRemaining = rateMetrics.remaining,
            rateLimitResetMillis = rateMetrics.resetIn.toMillis().coerceAtLeast(0),
            starCacheTtlMinutes = LevelheadConfig.starCacheTtlMinutes,
            cacheMissesCold = statsCacheSnapshot.cold,
            cacheMissesExpired = statsCacheSnapshot.expired,
            serverCooldownMillis = rateMetrics.serverCooldown?.toMillis()?.coerceAtLeast(0)
        )
    }

    private fun updateDisplayCache(display: LevelheadDisplay, uuid: UUID, stats: GameStats?, gameMode: GameMode) {
        if (!display.config.enabled) return
        val activeMode = ModeManager.getActiveGameMode()
        if (logger.isDebugEnabled) {
            logger.debug("updateDisplayCache: uuid={}, statsType={}, resolvedGameMode={}, displayConfigType={}, displayConfigGameMode={}, activeMode={}",
                uuid, stats?.let { it::class.simpleName }, gameMode, display.config.type, display.config.gameMode, activeMode)
        }
        val tag = StatsFormatter.formatTag(uuid, stats, display.config, gameMode)
        val cacheKey = DisplayCacheKey(uuid, gameMode)
        if (logger.isDebugEnabled) {
            logger.debug("updateDisplayCache: writing tag='{}' to display.cache[{}]", tag.getString(), cacheKey)
        }
        DebugLogging.logRequestDebug {
            "[LevelheadDebug][tag] uuid=${uuid.maskForLogs()}, gameMode=$gameMode, tag=${tag.getString().truncateForLogs(200)}, header=${tag.header.value.truncateForLogs(50)} (${tag.header.color.formatAsHex()}), footer=${tag.footer.value.truncateForLogs(50)} (${tag.footer.color.formatAsHex()})"
        }
        display.cache[cacheKey] = tag
    }

    private fun resolveGameMode(typeId: String): GameMode {
        val resolved = GameMode.fromTypeId(typeId) ?: GameMode.BEDWARS
        logger.debug("resolveGameMode: typeId={} -> {}", typeId, resolved)
        return resolved
    }

    private fun statsForMode(stats: GameStats?, gameMode: GameMode): GameStats? {
        val result = when (gameMode) {
            GameMode.BEDWARS -> stats as? GameStats.Bedwars
            GameMode.DUELS -> stats as? GameStats.Duels
            GameMode.SKYWARS -> stats as? GameStats.SkyWars
        }
        if (logger.isDebugEnabled) {
            logger.debug("statsForMode: inputStatsType={}, requestedGameMode={} -> resultType={} (null means input was null or cast failed)",
                stats?.let { it::class.simpleName }, gameMode, result?.let { it::class.simpleName })
        }
        return result
    }

    private fun formatCooldownDuration(duration: Duration): String {
        val totalSeconds = duration.seconds.coerceAtLeast(0)
        val minutes = totalSeconds / 60
        val seconds = totalSeconds % 60
        return String.format(Locale.ROOT, "%d:%02d", minutes, seconds)
    }

    data class LevelheadRequest(
        val uuid: String,
        val display: LevelheadDisplay,
        val allowOverride: Boolean,
        val type: String = display.config.type,
        val reason: RequestReason = RequestReason.UNKNOWN
    )

    enum class RequestReason {
        PLAYER_JOIN,        // Individual player joined world
        REQUEST_ALL_DISPLAYS,  // Initial fetch for all visible players
        REFRESH_VISIBLE_DISPLAYS, // Config change refresh
        TAB_LIST,           // Tab list stats fetch
        UNKNOWN             // Fallback for backward compatibility
    }

    data class DisplayCacheKey(val uuid: UUID, val gameMode: GameMode)

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
}
