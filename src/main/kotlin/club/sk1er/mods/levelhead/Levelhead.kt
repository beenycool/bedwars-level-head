package club.sk1er.mods.levelhead

import cc.polyfrost.oneconfig.utils.commands.CommandManager
import club.sk1er.mods.levelhead.commands.LevelheadCommand
import club.sk1er.mods.levelhead.config.LevelheadConfig
import club.sk1er.mods.levelhead.core.DisplayManager
import club.sk1er.mods.levelhead.core.GameMode
import club.sk1er.mods.levelhead.core.GameStats
import club.sk1er.mods.levelhead.core.ModeManager
import club.sk1er.mods.levelhead.core.RateLimiter
import club.sk1er.mods.levelhead.core.RateLimiterMetrics
import club.sk1er.mods.levelhead.core.RequestCoordinator
import club.sk1er.mods.levelhead.core.StatsStore
import club.sk1er.mods.levelhead.render.AboveHeadRender
import com.google.gson.Gson
import com.google.gson.JsonParser
import kotlinx.coroutines.CoroutineExceptionHandler
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
import okhttp3.ConnectionPool
import okhttp3.OkHttpClient
import okhttp3.Request
import org.apache.logging.log4j.LogManager
import org.apache.logging.log4j.Logger
import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import java.time.Duration
import java.util.Locale
import java.util.UUID
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong
import club.sk1er.mods.levelhead.core.ClientAccess

@Mod(
    modid = Levelhead.MODID,
    name = "BedWars Levelhead",
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
    
    val okHttpClient: OkHttpClient = OkHttpClient.Builder()
        .connectionPool(ConnectionPool(10, 5, TimeUnit.MINUTES))
        .connectTimeout(5, TimeUnit.SECONDS)
        .readTimeout(10, TimeUnit.SECONDS)
        .writeTimeout(10, TimeUnit.SECONDS)
        .callTimeout(15, TimeUnit.SECONDS)
        .build()
    val gson = Gson()
    val jsonParser = JsonParser()

    val displayManager: DisplayManager by lazy { DisplayManager() }

    /**
     * Failures in a coroutine must be visible. Without a handler an uncaught
     * exception disappeared entirely, which is how a successful fetch could turn
     * into a silent "?".
     */
    private val coroutineExceptionHandler = CoroutineExceptionHandler { _, throwable ->
        logger.error("Uncaught exception in Levelhead worker coroutine", throwable)
    }

    private val modJob: Job = SupervisorJob()
    val scope: CoroutineScope = CoroutineScope(modJob + Dispatchers.IO + coroutineExceptionHandler)
    private val worldScopeLock = Any()
    @Volatile
    private var worldJob: Job = SupervisorJob(modJob)
    @Volatile
    private var worldScope: CoroutineScope = CoroutineScope(worldJob + Dispatchers.IO + coroutineExceptionHandler)
    val rateLimiter: RateLimiter = RateLimiter(600, Duration.ofMinutes(1), onBlocked = ::onRateLimiterBlocked, onReset = ::resetRateLimiterNotification)
    val statsStore: StatsStore = StatsStore(
        maxSizeProvider = { displayManager.config.purgeSize },
        ttlProvider = { LevelheadConfig.starCacheTtl }
    )
    val requestCoordinator: RequestCoordinator = RequestCoordinator(
        worldScopeProvider = { worldScope },
        store = statsStore,
        rateLimiter = rateLimiter,
        isOnHypixel = ::isOnHypixel,
        logger = logger
    )

    private val rateLimiterNotified = AtomicBoolean(false)
    private val serverCooldownNotifiedUntil = AtomicLong(0L)
    private val updateCheckScheduled = AtomicBoolean(false)
    private val firstWorldJoined = AtomicBoolean(false)
    private val lastServerCooldownNotificationAt = AtomicLong(0L)

    const val MODID = "bedwars_levelhead"

    /**
     * Read from the packaged `mcmod.info`, whose version is expanded from
     * `gradle.properties`'s BUILD_ID at build time. That makes BUILD_ID the single
     * version source instead of a third hard-coded string.
     */
    val VERSION: String by lazy {
        runCatching {
            val stream = Levelhead::class.java.getResourceAsStream("/mcmod.info") ?: return@runCatching null
            stream.use { input ->
                val text = input.reader(StandardCharsets.UTF_8).readText()
                val json = JsonParser.parseString(text)
                json.asJsonArray.firstOrNull()?.asJsonObject?.get("version")?.asString
            }
        }.getOrNull()?.takeIf { it.isNotBlank() && !it.contains("\${") } ?: "local"
    }
    private const val MODRINTH_PROJECT_SLUG = "bedwars-level-head"
    private const val MODRINTH_MOD_PAGE = "https://modrinth.com/mod/$MODRINTH_PROJECT_SLUG"
    private const val MODRINTH_API_BASE = "https://api.modrinth.com/v2"
    private const val TARGET_MC_VERSION = "1.8.9"
    private const val TARGET_LOADER = "forge"

    private val minecraft: Minecraft
        get() = Minecraft.getMinecraft()

    fun isOnHypixel(): Boolean = ClientAccess.hypixelServerCheck()

    fun sendChat(message: String) {
        val formatted = "${ChatColor.AQUA}[Levelhead] ${ChatColor.RESET}$message"
        minecraft.addScheduledTask {
            minecraft.thePlayer?.addChatMessage(ChatComponentText(formatted))
        }
    }

    /**
     * Run [block] on the Minecraft client thread. Client state (world, scoreboard,
     * entity list) must only be touched there.
     */
    fun runOnMain(block: () -> Unit) {
        val client = minecraft
        if (client.isCallingFromMinecraftThread) {
            block()
        } else {
            client.addScheduledTask { block() }
        }
    }

    /** Launch per-world work that is cancelled on the next world change. */
    fun launchWorld(block: suspend CoroutineScope.() -> Unit): Job = worldScope.launch(block = block)

    /**
     * Run [block] on the client thread and suspend the caller until it returns.
     * Used by IO workers that need a client-thread read (scoreboard / server state).
     */
    suspend fun <T> onMainResult(block: () -> T): T {
        val client = minecraft
        if (client.isCallingFromMinecraftThread) return block()
        val deferred = kotlinx.coroutines.CompletableDeferred<T>()
        client.addScheduledTask {
            try {
                deferred.complete(block())
            } catch (throwable: Throwable) {
                deferred.completeExceptionally(throwable)
            }
        }
        return deferred.await()
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
                    // Modrinth's version_number and the packaged version use
                    // different naming (e.g. "v8.3.0" vs "8.3.0"), so compare the
                    // numeric segments instead of requiring an exact string.
                    if (!isRemoteVersionNewer(latestVersion, VERSION)) {
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

    /**
     * True only when [remote] is a strictly newer release than [local]. Missing or
     * non-numeric segments are ignored, so "v8.3.0", "8.3.0" and "8.3.0+forge"
     * compare equal and do not nag forever.
     */
    internal fun isRemoteVersionNewer(remote: String, local: String): Boolean {
        val remoteParts = versionSegments(remote)
        val localParts = versionSegments(local)
        if (remoteParts.isEmpty() || localParts.isEmpty()) return false
        for (index in 0 until maxOf(remoteParts.size, localParts.size)) {
            val remotePart = remoteParts.getOrNull(index) ?: 0
            val localPart = localParts.getOrNull(index) ?: 0
            if (remotePart != localPart) return remotePart > localPart
        }
        return false
    }

    private fun versionSegments(version: String): List<Int> =
        Regex("\\d+").findAll(version.removePrefix("v").removePrefix("V"))
            .mapNotNull { it.value.toIntOrNull() }
            .toList()

    private fun buildModrinthVersionUrl(): String {
        val encodedVersions = "[\"$TARGET_MC_VERSION\"]".encodeForUrl()
        val encodedLoaders = "[\"$TARGET_LOADER\"]".encodeForUrl()
        return "$MODRINTH_API_BASE/project/$MODRINTH_PROJECT_SLUG/version?game_versions=$encodedVersions&loaders=$encodedLoaders"
    }

    private fun String.encodeForUrl(): String =
        URLEncoder.encode(this, StandardCharsets.UTF_8.name()).replace("+", "%20")

    fun preInit(@Suppress("UNUSED_PARAMETER") event: FMLPreInitializationEvent) {
        LevelheadConfig
    }

    fun postInit(@Suppress("UNUSED_PARAMETER") event: FMLPostInitializationEvent) {
        MinecraftForge.EVENT_BUS.register(AboveHeadRender)
        MinecraftForge.EVENT_BUS.register(ModeManager.tracker)
        MinecraftForge.EVENT_BUS.register(this)
        CommandManager.INSTANCE.registerCommand(LevelheadCommand())
        // The update check needs a player and a world; doing it here
        // (thePlayer == null) dropped the chat and still set the "checked"
        // flag. It runs on the first world join instead.
    }

    @SubscribeEvent
    fun joinServer(@Suppress("UNUSED_PARAMETER") event: FMLNetworkEvent.ClientConnectedToServerEvent) {
        club.sk1er.mods.levelhead.core.StatsFetcher.resetWarnings()
        // Fires on the netty IO thread. Cancel the previous connection's work on the
        // client thread. The stats store survives connections; its TTL decides when
        // anything is refetched.
        runOnMain {
            resetWorldScope()
            requestCoordinator.reset()
        }
    }

    @SubscribeEvent
    fun playerJoin(event: EntityJoinWorldEvent) {
        val entity = event.entity
        if (entity is EntityPlayerSP) {
            resetWorldScope()
            // Do not reset the rate limiter here: a lobby hop must not refill the
            // token budget or forget a server Retry-After. TTL on the store
            // (not a world join) decides when stats are refetched.
            requestCoordinator.reset()
            if (firstWorldJoined.compareAndSet(false, true)) {
                scheduleUpdateCheck()
            }
            // joinWorld resets the mode tracker (new world epoch) and samples it.
            displayManager.joinWorld(resetDetector = true)
        } else if (entity is EntityPlayer) {
            displayManager.playerJoin(entity)
        }
    }

    @SubscribeEvent
    fun onClientTick(event: TickEvent.ClientTickEvent) {
        if (event.phase != TickEvent.Phase.END) return
        displayManager.tick()
    }

    fun getCachedStats(uuid: UUID, gameMode: GameMode): GameStats? {
        return statsStore.get(uuid, gameMode)
    }

    fun clearCachedStats() {
        statsStore.clear()
        statsStore.resetMetrics()
        requestCoordinator.reset()
        club.sk1er.mods.levelhead.core.FetchBackoff.reset()
    }

    internal fun onRateLimiterBlocked(metrics: RateLimiterMetrics) {
        val cooldown = metrics.serverCooldown
        if (cooldown != null && !cooldown.isZero && !cooldown.isNegative) {
            // A server Retry-After is the common "throttled" case; never return
            // early for it. Tell the user the truth: requests are paused.
            onServerRetryAfter(cooldown)
            return
        }
        if (rateLimiterNotified.compareAndSet(false, true)) {
            val resetText = formatCooldownDuration(metrics.resetIn)
            sendChat(
                "${ChatColor.YELLOW}Stats rate limit reached. ${ChatColor.GOLD}${metrics.remaining} requests remaining${ChatColor.YELLOW}. Window resets in $resetText."
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
                    "${ChatColor.YELLOW}The stats server asked us to pause requests for ${ChatColor.GOLD}$formatted${ChatColor.YELLOW}."
                )
                return
            }
        }
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
        val statsCacheSnapshot = statsStore.metricsSnapshot()
        return StatusSnapshot(
            backendConfigured = LevelheadConfig.proxyBaseUrl.isNotBlank(),
            cacheSize = statsStore.size(),
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

    private fun formatCooldownDuration(duration: Duration): String {
        val totalSeconds = duration.seconds.coerceAtLeast(0)
        val minutes = totalSeconds / 60
        val seconds = totalSeconds % 60
        return String.format(Locale.ROOT, "%d:%02d", minutes, seconds)
    }

    data class LevelheadRequest(
        val uuid: String,
        val type: String,
        val reason: RequestReason = RequestReason.UNKNOWN
    )

    enum class RequestReason {
        PLAYER_JOIN,        // Individual player joined world
        REQUEST_ALL_DISPLAYS,  // Initial fetch for all visible players
        REFRESH_VISIBLE_DISPLAYS, // Config change refresh
        TAB_LIST,           // Tab list stats fetch
        UNKNOWN             // Fallback for backward compatibility
    }

    data class StatusSnapshot(
        val backendConfigured: Boolean,
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
