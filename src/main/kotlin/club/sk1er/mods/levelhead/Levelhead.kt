package club.sk1er.mods.levelhead

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
import com.google.gson.JsonParser
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Deferred
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
import net.minecraft.command.ICommand
import net.minecraft.command.ICommandManager
import net.minecraft.command.ServerCommandManager
import net.minecraft.entity.player.EntityPlayer
import net.minecraft.util.ChatComponentText
import net.minecraftforge.common.MinecraftForge
import net.minecraftforge.event.entity.EntityJoinWorldEvent
import net.minecraftforge.fml.common.Mod
import net.minecraftforge.fml.common.event.FMLInitializationEvent
import net.minecraftforge.fml.common.event.FMLPostInitializationEvent
import net.minecraftforge.fml.common.event.FMLPreInitializationEvent
import net.minecraftforge.fml.common.eventhandler.SubscribeEvent
import net.minecraftforge.fml.common.network.FMLNetworkEvent
import okhttp3.OkHttpClient
import okhttp3.Request
import org.apache.logging.log4j.LogManager
import org.apache.logging.log4j.Logger
import java.awt.Color
import java.io.File
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
import org.polyfrost.oneconfig.api.config.v1.ConfigManager
import org.polyfrost.oneconfig.api.config.v1.ConfigProvider
import org.polyfrost.oneconfig.api.ui.v1.UIManager
import org.polyfrost.oneconfig.api.event.v1.EventManager
import org.polyfrost.oneconfig.api.event.v1.events.InitializationEvent

@Mod(modid = Levelhead.MODID, name = "BedWars Levelhead", version = Levelhead.VERSION)
object Levelhead {
    val logger: Logger = LogManager.getLogger()
    val okHttpClient: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(5, TimeUnit.SECONDS)
        .readTimeout(5, TimeUnit.SECONDS)
        .writeTimeout(5, TimeUnit.SECONDS)
        .build()
    val gson = Gson()
    val jsonParser = JsonParser()

    lateinit var displayManager: DisplayManager
        private set

    private val modJob: Job = SupervisorJob()
    val scope: CoroutineScope = CoroutineScope(modJob + Dispatchers.IO)
    private val worldScopeLock = Any()
    @Volatile
    private var worldJob: Job = SupervisorJob(modJob)
    @Volatile
    private var worldScope: CoroutineScope = CoroutineScope(worldJob + Dispatchers.IO)
    val rateLimiter: RateLimiter = RateLimiter(150, Duration.ofMinutes(5))

    private val starCache: ConcurrentHashMap<UUID, CachedBedwarsStar> = ConcurrentHashMap()
    private val inFlightStarRequests: ConcurrentHashMap<UUID, Deferred<CachedBedwarsStar?>> = ConcurrentHashMap()
    private val pendingDisplayRefreshes: ConcurrentHashMap<UUID, MutableSet<LevelheadDisplay>> = ConcurrentHashMap()
    private val starFetchSemaphore: Semaphore = Semaphore(6)
    private val rateLimiterNotified = AtomicBoolean(false)
    private val starCacheMetrics = StarCacheMetrics()
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
                    Minecraft.getMinecraft().addScheduledTask {
                        val commandManager = ServerCommandManager.instance
                        val command = commandManager.getCommands().firstOrNull { it.commandName == "levelhead" } as? ICommand
                        if (command != null) {
                            commandManager.executeCommand(Minecraft.getMinecraft().thePlayer, "levelhead")
                        }
                    }
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

    private fun sendPrefixedChat(message: String) {
        val mc = Minecraft.getMinecraft()
        mc.addScheduledTask {
            mc.thePlayer?.addChatMessage(ChatComponentText(message))
        }
    }

    private fun showWelcomeMessageIfNeeded() {
        if (LevelheadConfig.welcomeMessageShown) {
            return
        }
        LevelheadConfig.setWelcomeMessageShown(true)
        sendPrefixedChat("§b[Levelhead]§eThanks for installing Levelhead!")
        sendPrefixedChat("§b[Levelhead]§eThe mod is in alpha, so bugs may occur. Report issues on GitHub or to beenyiscool on Discord.")
    }

    val DarkChromaColor: Int
        get() = Color.HSBtoRGB(System.currentTimeMillis() % 1000 / 1000f, 0.8f, 0.2f)
    val ChromaColor: Int
        get() = Color.HSBtoRGB(System.currentTimeMillis() % 1000 / 1000f, 0.8f, 0.8f)
    val chromaColor: Color
        get() = Color(ChromaColor)

    @Mod.EventHandler
    fun preInit(event: FMLPreInitializationEvent) {
        val configDirectory = event.modConfigurationDirectory ?: File(Minecraft.getMinecraft().mcDataDir, "config")
        val jsonConfigFile = File(configDirectory, "bedwars-level-head.json")

        // Register OneConfig config implementation
        ConfigManager.register(object : ConfigProvider {
            override fun getModId(): String = MODID
            override fun getConfigInstance() = LevelheadConfig
        })

        LevelheadConfig.initialize(jsonConfigFile)

        displayManager = DisplayManager(jsonConfigFile)
    }

    @Mod.EventHandler
    fun init(@Suppress("UNUSED_PARAMETER") event: FMLInitializationEvent) {
        MinecraftForge.EVENT_BUS.register(AboveHeadRender)
        MinecraftForge.EVENT_BUS.register(BedwarsModeDetector)
        MinecraftForge.EVENT_BUS.register(this)

        // Ensure OneConfig UI is ready before using UI hooks
        EventManager.register(InitializationEvent::class.java) {
            // Hook to open our config screen via OneConfig menus if desired
            UIManager.INSTANCE.registerConfig(MODID, "BedWars Levelhead") { LevelheadConfig }
        }
    }

    @Mod.EventHandler
    fun postInit(@Suppress("UNUSED_PARAMETER") event: FMLPostInitializationEvent) {
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
            clearCachedStars()
            resetFetchTimestamps()
            displayManager.joinWorld(resetDetector = true)
        } else if (event.entity is EntityPlayer) {
            displayManager.playerJoin(event.entity as EntityPlayer)
        }
    }

    fun fetch(requests: List<LevelheadRequest>): Job {
        return worldScope.launch {
            if (!BedwarsModeDetector.shouldRequestData()) return@launch

            requests
                .groupBy { it.uuid }
                .forEach { (trimmedUuid, groupedRequests) ->
                    val uuid = trimmedUuid.dashUUID ?: return@forEach
                    val displays = groupedRequests.map { it.display }.toSet()
                    val cached = resolveStar(uuid, displays)
                    applyStarToRequests(uuid, groupedRequests, cached)
                }
        }
    }

    fun clearCachedStars() {
        starCache.clear()
        pendingDisplayRefreshes.clear()
        inFlightStarRequests.values.forEach { it.cancel() }
        inFlightStarRequests.clear()
        starCacheMetrics.reset()
    }

    internal fun onRateLimiterBlocked(metrics: Metrics) {
        if (rateLimiterNotified.compareAndSet(false, true)) {
            val resetText = formatCooldownDuration(metrics.resetIn)
            sendPrefixedChat("§b[Levelhead]§eBedWars stats cooling down. §6${metrics.remaining}§e requests remaining. Reset in $resetText.")
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
                sendPrefixedChat("§b[Levelhead]§eProxy asked us to pause BedWars stat requests for §6$formatted§e.")
                return
            }
        }
    }

    internal fun resetServerCooldownNotification() {
        serverCooldownNotifiedUntil.set(0L)
    }

    private suspend fun resolveStar(uuid: UUID, displays: Collection<LevelheadDisplay>): CachedBedwarsStar? {
        val cached = starCache[uuid]
        val now = System.currentTimeMillis()
        return when {
            cached == null -> {
                starCacheMetrics.recordMiss(CacheMissReason.COLD)
                ensureStarFetch(uuid, cached, displays, registerForRefresh = false).await()
            }
            cached.isExpired(LevelheadConfig.starCacheTtl, now) -> {
                starCacheMetrics.recordMiss(CacheMissReason.EXPIRED)
                ensureStarFetch(uuid, cached, displays, registerForRefresh = true)
                cached
            }
            else -> cached
        }
    }

    private fun ensureStarFetch(
        uuid: UUID,
        cached: CachedBedwarsStar?,
        displays: Collection<LevelheadDisplay>,
        registerForRefresh: Boolean
    ): Deferred<CachedBedwarsStar?> {
        if (registerForRefresh && displays.isNotEmpty()) {
            registerDisplaysForRefresh(uuid, displays)
        }

        val existing = inFlightStarRequests[uuid]
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
                            val experience = BedwarsStar.extractExperience(result.payload)
                            val star = experience?.let { BedwarsStar.calculateStar(it) }
                            val entry = CachedBedwarsStar(star, experience, System.currentTimeMillis())
                            handleStarUpdate(uuid, entry)
                            entry
                        }
                        BedwarsFetcher.FetchResult.NotModified -> {
                            lastFetchSuccessAt = System.currentTimeMillis()
                            val refreshed = cached?.copy(fetchedAt = System.currentTimeMillis())
                            refreshed?.let { handleStarUpdate(uuid, it) }
                            refreshed
                        }
                        is BedwarsFetcher.FetchResult.TemporaryError -> {
                            handleStarUpdate(uuid, cached)
                            null
                        }
                        is BedwarsFetcher.FetchResult.PermanentError -> {
                            handleStarUpdate(uuid, cached)
                            null
                        }
                    }
                } catch (throwable: Throwable) {
                    handleStarUpdate(uuid, null)
                    null
                }
            }
        }

        val previous = inFlightStarRequests.putIfAbsent(uuid, deferred)
        if (previous != null) {
            deferred.cancel()
            if (registerForRefresh && displays.isNotEmpty()) {
                registerDisplaysForRefresh(uuid, displays)
            }
            return previous
        }

        deferred.invokeOnCompletion { inFlightStarRequests.remove(uuid, deferred) }
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
        val starCacheSnapshot = starCacheMetrics.snapshot()
        return StatusSnapshot(
            proxyEnabled = LevelheadConfig.proxyEnabled,
            proxyConfigured = LevelheadConfig.proxyEnabled && LevelheadConfig.proxyBaseUrl.isNotBlank() && LevelheadConfig.proxyAuthToken.isNotBlank(),
            cacheSize = starCache.size,
            lastAttemptAgeMillis = attemptAge,
            lastSuccessAgeMillis = successAge,
            rateLimitRemaining = rateMetrics.remaining,
            rateLimitResetMillis = rateMetrics.resetIn.toMillis().coerceAtLeast(0),
            starCacheTtlMinutes = LevelheadConfig.starCacheTtlMinutes,
            cacheMissesCold = starCacheSnapshot.cold,
            cacheMissesExpired = starCacheSnapshot.expired,
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

    private fun handleStarUpdate(uuid: UUID, entry: CachedBedwarsStar?) {
        if (entry != null) {
            starCache[uuid] = entry
        }
        val listeners = pendingDisplayRefreshes.remove(uuid) ?: return
        if (entry != null) {
            listeners
                .filter { it.config.enabled && it.cache.containsKey(uuid) }
                .forEach { display -> updateDisplayCache(display, uuid, entry) }
        }
    }

    private fun applyStarToRequests(
        uuid: UUID,
        requests: List<LevelheadRequest>,
        starData: CachedBedwarsStar?
    ) {
        requests
            .filter { it.type == BedwarsModeDetector.BEDWARS_STAR_TYPE }
            .forEach { req -> updateDisplayCache(req.display, uuid, starData) }
    }

    private fun updateDisplayCache(display: LevelheadDisplay, uuid: UUID, starData: CachedBedwarsStar?) {
        if (!display.config.enabled) return
        val starValue = starData?.star
        val starString = starValue?.let { "$it✪" } ?: "?"
        val footerTemplate = display.config.footerString
        val footerValue = footerTemplate?.replace("%star%", starString, true) ?: starString
        val style = starValue?.let { BedwarsStar.styleForStar(it) }
            ?: BedwarsStar.PrestigeStyle(display.config.footerColor, display.config.footerChroma)
        val tag = LevelheadTag.build(uuid) {
            header {
                value = "${display.config.headerString}: "
                color = display.config.headerColor
                chroma = display.config.headerChroma
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

    data class CachedBedwarsStar(val star: Int?, val experience: Long?, val fetchedAt: Long) {
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

    private class StarCacheMetrics {
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

        fun snapshot(): StarCacheSnapshot {
            return StarCacheSnapshot(coldMisses.get(), expiredMisses.get())
        }
    }

    data class StarCacheSnapshot(val cold: Long, val expired: Long)
}
