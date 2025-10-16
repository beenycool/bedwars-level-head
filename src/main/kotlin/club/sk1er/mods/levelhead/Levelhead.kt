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
import gg.essential.api.EssentialAPI
import gg.essential.universal.ChatColor
import gg.essential.universal.UMinecraft
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.cancelChildren
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import net.minecraft.client.entity.EntityPlayerSP
import net.minecraft.entity.player.EntityPlayer
import net.minecraftforge.common.MinecraftForge
import net.minecraftforge.event.entity.EntityJoinWorldEvent
import net.minecraftforge.fml.common.Mod
import net.minecraftforge.fml.common.event.FMLPostInitializationEvent
import net.minecraftforge.fml.common.event.FMLPreInitializationEvent
import net.minecraftforge.fml.common.eventhandler.SubscribeEvent
import net.minecraftforge.fml.common.network.FMLNetworkEvent
import okhttp3.OkHttpClient
import org.apache.logging.log4j.LogManager
import org.apache.logging.log4j.Logger
import java.awt.Color
import java.io.File
import java.time.Duration
import java.util.Locale
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

@Mod(modid = Levelhead.MODID, name = "BedWars Levelhead", version = Levelhead.VERSION, modLanguageAdapter = "gg.essential.api.utils.KotlinAdapter")
object Levelhead {
    val logger: Logger = LogManager.getLogger()
    val okHttpClient: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(5, TimeUnit.SECONDS)
        .readTimeout(5, TimeUnit.SECONDS)
        .writeTimeout(5, TimeUnit.SECONDS)
        .build()
    val gson = Gson()
    val jsonParser = JsonParser()

    val displayManager: DisplayManager = DisplayManager(File(File(UMinecraft.getMinecraft().mcDataDir, "config"), "levelhead.json"))
    val scope: CoroutineScope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    val rateLimiter: RateLimiter = RateLimiter(150, Duration.ofMinutes(5))

    private val starCacheTtl: Duration = Duration.ofMinutes(10)
    private val starCache: ConcurrentHashMap<UUID, CachedBedwarsStar> = ConcurrentHashMap()
    private val inFlightStarRequests: ConcurrentHashMap<UUID, Deferred<CachedBedwarsStar?>> = ConcurrentHashMap()
    private val pendingDisplayRefreshes: ConcurrentHashMap<UUID, MutableSet<LevelheadDisplay>> = ConcurrentHashMap()
    private val starFetchSemaphore: Semaphore = Semaphore(4)
    private val rateLimiterNotified = AtomicBoolean(false)

    val DarkChromaColor: Int
        get() = Color.HSBtoRGB(System.currentTimeMillis() % 1000 / 1000f, 0.8f, 0.2f)
    val ChromaColor: Int
        get() = Color.HSBtoRGB(System.currentTimeMillis() % 1000 / 1000f, 0.8f, 0.8f)
    val chromaColor: Color
        get() = Color(ChromaColor)

    const val MODID = "bedwars_levelhead"
    const val VERSION = "8.2.3"

    @Mod.EventHandler
    fun preInit(event: FMLPreInitializationEvent) {
        val configDirectory = event.modConfigurationDirectory ?: File(UMinecraft.getMinecraft().mcDataDir, "config")
        val configFile = File(configDirectory, "bedwars-level-head.cfg")
        LevelheadConfig.initialize(configFile)
    }

    @Mod.EventHandler
    fun postInit(@Suppress("UNUSED_PARAMETER") event: FMLPostInitializationEvent) {
        MinecraftForge.EVENT_BUS.register(AboveHeadRender)
        MinecraftForge.EVENT_BUS.register(BedwarsModeDetector)
        MinecraftForge.EVENT_BUS.register(this)
        EssentialAPI.getCommandRegistry().registerCommand(LevelheadCommand())
    }

    @SubscribeEvent
    fun joinServer(@Suppress("UNUSED_PARAMETER") event: FMLNetworkEvent.ClientConnectedToServerEvent) {
        BedwarsFetcher.resetWarnings()
        scope.coroutineContext.cancelChildren()
        rateLimiter.resetState()
        displayManager.clearCachesWithoutRefetch()
        clearCachedStars()
        scope.launch { displayManager.requestAllDisplays() }
    }

    @SubscribeEvent
    fun playerJoin(event: EntityJoinWorldEvent) {
        if (event.entity is EntityPlayerSP) {
            scope.coroutineContext.cancelChildren()
            rateLimiter.resetState()
            displayManager.joinWorld(resetDetector = true)
            clearCachedStars()
        } else if (event.entity is EntityPlayer) {
            displayManager.playerJoin(event.entity as EntityPlayer)
        }
    }

    fun fetch(requests: List<LevelheadRequest>): Job {
        return scope.launch {
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
    }

    internal fun onRateLimiterBlocked(metrics: Metrics) {
        if (rateLimiterNotified.compareAndSet(false, true)) {
            val resetText = formatCooldownDuration(metrics.resetIn)
            UMinecraft.getMinecraft().addScheduledTask {
                EssentialAPI.getMinecraftUtil().sendMessage(
                    "${ChatColor.AQUA}[Levelhead]",
                    "${ChatColor.YELLOW}BedWars stats cooling down. ${ChatColor.GOLD}${metrics.remaining} requests remaining${ChatColor.YELLOW}. Reset in $resetText."
                )
            }
        }
    }

    internal fun resetRateLimiterNotification() {
        rateLimiterNotified.set(false)
    }

    private suspend fun resolveStar(uuid: UUID, displays: Collection<LevelheadDisplay>): CachedBedwarsStar? {
        val cached = starCache[uuid]
        val now = System.currentTimeMillis()
        return when {
            cached == null -> ensureStarFetch(uuid, displays, registerForRefresh = false).await()
            cached.isExpired(starCacheTtl, now) -> {
                ensureStarFetch(uuid, displays, registerForRefresh = true)
                cached
            }
            else -> cached
        }
    }

    private fun ensureStarFetch(
        uuid: UUID,
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

        val deferred = scope.async {
            starFetchSemaphore.withPermit {
                try {
                    rateLimiter.consume()
                    val player = BedwarsFetcher.fetchPlayer(uuid) ?: run {
                        handleStarUpdate(uuid, null)
                        return@withPermit null
                    }
                    val experience = BedwarsStar.extractExperience(player)
                    val star = experience?.let { BedwarsStar.calculateStar(it) }
                    val entry = CachedBedwarsStar(star, experience, System.currentTimeMillis())
                    handleStarUpdate(uuid, entry)
                    entry
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
        val starString = starValue?.let { "$it★" } ?: "?"
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
}
