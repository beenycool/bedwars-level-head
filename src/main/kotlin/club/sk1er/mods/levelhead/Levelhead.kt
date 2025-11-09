package club.sk1er.mods.levelhead

import club.sk1er.mods.levelhead.bedwars.BedwarsFetcher
import club.sk1er.mods.levelhead.commands.LevelheadCommand
import club.sk1er.mods.levelhead.config.ApiKeyStore
import club.sk1er.mods.levelhead.config.DisplayConfig
import club.sk1er.mods.levelhead.config.LevelheadConfig
import club.sk1er.mods.levelhead.config.MasterConfig
import club.sk1er.mods.levelhead.core.BedwarsModeDetector
import club.sk1er.mods.levelhead.core.BedwarsStar
import club.sk1er.mods.levelhead.core.DisplayManager
import club.sk1er.mods.levelhead.core.RateLimiter
import club.sk1er.mods.levelhead.render.AboveHeadRender
import dev.deftu.omnicore.api.client.chat.OmniClientChat
import net.minecraft.client.Minecraft
import net.minecraft.client.settings.KeyBinding
import net.minecraft.entity.player.EntityPlayer
import net.minecraftforge.common.MinecraftForge
import net.minecraftforge.fml.client.registry.ClientRegistry
import net.minecraftforge.fml.common.Mod
import net.minecraftforge.fml.common.event.FMLInitializationEvent
import net.minecraftforge.fml.common.event.FMLPreInitializationEvent
import net.minecraftforge.fml.common.eventhandler.SubscribeEvent
import net.minecraftforge.fml.common.gameevent.InputEvent
import net.minecraftforge.fml.common.gameevent.TickEvent
import net.minecraftforge.fml.relauncher.Side
import net.minecraftforge.fml.relauncher.SideOnly
import okhttp3.OkHttpClient
import org.apache.logging.log4j.LogManager
import org.polyfrost.oneconfig.api.config.v1.Config
import org.polyfrost.oneconfig.api.mod.OneConfigMod
import java.io.File
import java.time.Duration
import java.util.Locale
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancelChildren
import kotlinx.coroutines.Dispatchers

@Mod(modid = "levelhead", version = "2.0.0", clientSideOnly = true)
@SideOnly(Side.CLIENT)
object Levelhead : OneConfigMod("levelhead") {
    const val VERSION = "2.0.0"
    const val MODID = "levelhead"

    private val loggerImpl = LogManager.getLogger("Levelhead")
    val logger = object {
        fun error(msg: String, vararg args: Any?) = loggerImpl.error(msg, *args)
        fun warn(msg: String, vararg args: Any?) = loggerImpl.warn(msg, *args)
        fun info(msg: String, vararg args: Any?) = loggerImpl.info(msg, *args)
        fun debug(msg: String, vararg args: Any?) = loggerImpl.debug(msg, *args)
    }

    val okHttpClient: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(5, TimeUnit.SECONDS)
        .readTimeout(5, TimeUnit.SECONDS)
        .writeTimeout(5, TimeUnit.SECONDS)
        .build()

    val gson = com.google.gson.Gson()
    val jsonParser = com.google.gson.JsonParser()

    val rateLimiter = RateLimiter(150, Duration.ofMinutes(5))

    private val scopeJob = SupervisorJob()
    val scope = CoroutineScope(Dispatchers.IO + scopeJob)

    val bedwarsFetcher = BedwarsFetcher
    val bedwarsModeDetector = BedwarsModeDetector
    val bedwarsStar = BedwarsStar
    lateinit var displayManager: DisplayManager

    private var toggleKeybind: KeyBinding? = null
    private var lastDisplayUpdateTime = 0L
    private var rateLimiterNotified = false
    private var serverCooldownNotified = false

    data class StatusSnapshot(
        val proxyEnabled: Boolean,
        val proxyConfigured: Boolean,
        val cacheSize: Int,
        val starCacheTtlMinutes: Int,
        val cacheMissesCold: Int,
        val cacheMissesExpired: Int,
        val lastAttemptAgeMillis: Long?,
        val lastSuccessAgeMillis: Long?,
        val rateLimitRemaining: Int,
        val rateLimitResetMillis: Long?,
        val serverCooldownMillis: Long?
    )

    @Config(title = "Levelhead", description = "BedWars Levelhead Configuration")
    object ConfigHandler

    @Mod.EventHandler
    fun preInit(event: FMLPreInitializationEvent) {
        OneConfigMod.initialize()
        LevelheadCommand.register()

        val configDir = File(event.modConfigurationDirectory, "levelhead")
        if (!configDir.exists()) {
            configDir.mkdirs()
        }
        val apiKeyFile = File(configDir, "apikey.json")
        ApiKeyStore.initialize(apiKeyFile)

        displayManager = DisplayManager()
        LevelheadConfig.initialize()
    }

    @Mod.EventHandler
    fun init(event: FMLInitializationEvent) {
        MinecraftForge.EVENT_BUS.register(this)
        setupEventHandlers()
        registerKeybind()

        val apiKey = LevelheadConfig.General.apiKey
        if (apiKey.isNotEmpty()) {
            ApiKeyStore.setApiKey(apiKey)
        }

        logger.info("BedWars Levelhead mod initialised successfully")
    }

    private fun setupEventHandlers() {
        MinecraftForge.EVENT_BUS.register(AboveHeadRender())
        MinecraftForge.EVENT_BUS.register(displayManager)
        MinecraftForge.EVENT_BUS.register(bedwarsModeDetector)
    }

    private fun registerKeybind() {
        val keybind = KeyBinding("Toggle Levelhead", 0, "BedWars Levelhead")
        toggleKeybind = keybind
        ClientRegistry.registerKeyBinding(keybind)
    }

    @SubscribeEvent
    fun handleClientTick(event: TickEvent.ClientTickEvent) {
        if (event.phase != TickEvent.Phase.END) return
        onTick()
    }

    @SubscribeEvent
    fun handleKeyInput(event: InputEvent.KeyInputEvent) {
        val keybind = toggleKeybind ?: return
        if (keybind.isPressed) {
            DisplayConfig.enabled = !DisplayConfig.enabled
        }
    }

    private fun onTick() {
        val mc = Minecraft.getMinecraft()
        val player = mc.thePlayer ?: return
        if (!MasterConfig.enabled || !DisplayConfig.enabled) {
            return
        }

        val now = System.currentTimeMillis()
        if (now - lastDisplayUpdateTime < 1_000L) {
            return
        }
        lastDisplayUpdateTime = now

        if (!bedwarsModeDetector.shouldRequestData()) {
            return
        }

        updatePlayerDisplays(player)
    }

    private fun updatePlayerDisplays(localPlayer: EntityPlayer) {
        val world = localPlayer.worldObj ?: return
        val mode = DisplayConfig.type

        if (DisplayConfig.showSelf) {
            updatePlayerDisplay(localPlayer, mode)
        }

        world.playerEntities
            .asSequence()
            .filterIsInstance<EntityPlayer>()
            .filter { it.uniqueID != localPlayer.uniqueID }
            .forEach { updatePlayerDisplay(it, mode) }
    }

    private fun updatePlayerDisplay(player: EntityPlayer, mode: String) {
        val star = bedwarsFetcher.getStar(player.name) ?: return
        val displayText = formatLevelDisplay(star, mode) ?: return
        displayManager.setDisplay(player.uniqueID, player.name, displayText)
    }

    private fun formatLevelDisplay(level: Int, mode: String): String? {
        if (!DisplayConfig.enabled) return null

        val header = DisplayConfig.headerString.takeUnless { it.isBlank() }?.let { "$it: " } ?: ""
        val footerTemplate = DisplayConfig.footerString ?: "%star%"
        val footer = footerTemplate.replace("%star%", level.toString())
        return "$header$footer"
    }

    private fun onConfigChange() {
        if (!MasterConfig.enabled) {
            displayManager.clearAll()
        }

        val currentKey = ApiKeyStore.getApiKey() ?: ""
        val newKey = LevelheadConfig.General.apiKey
        if (currentKey != newKey && newKey.isNotEmpty()) {
            ApiKeyStore.setApiKey(newKey)
        }
    }

    override fun onConfigSaved() {
        onConfigChange()
    }

    fun resetWorldCoroutines() {
        scopeJob.cancelChildren()
    }

    fun clearCachedStars() {
        bedwarsFetcher.clearCache()
        displayManager.clearCachesWithoutRefetch()
    }

    fun statusSnapshot(): StatusSnapshot {
        val metrics = rateLimiter.metricsSnapshot()
        return StatusSnapshot(
            proxyEnabled = LevelheadConfig.proxyEnabledValue,
            proxyConfigured = LevelheadConfig.proxyEnabledValue && LevelheadConfig.proxyBaseUrlValue.isNotBlank(),
            cacheSize = bedwarsFetcher.cacheSize(),
            starCacheTtlMinutes = LevelheadConfig.starCacheTtlMinutesValue,
            cacheMissesCold = bedwarsFetcher.cacheMissesCold(),
            cacheMissesExpired = bedwarsFetcher.cacheMissesExpired(),
            lastAttemptAgeMillis = bedwarsFetcher.lastAttemptAgeMillis(),
            lastSuccessAgeMillis = bedwarsFetcher.lastSuccessAgeMillis(),
            rateLimitRemaining = metrics.remaining,
            rateLimitResetMillis = metrics.resetIn.toMillis(),
            serverCooldownMillis = metrics.serverCooldown?.toMillis()
        )
    }

    fun resetRateLimiterNotification() {
        rateLimiterNotified = false
    }

    fun onRateLimiterBlocked(metrics: RateLimiter.Metrics) {
        if (rateLimiterNotified) return
        rateLimiterNotified = true
        val seconds = metrics.resetIn.seconds.coerceAtLeast(0)
        OmniClientChat.displayChatMessage("§eBedWars Levelhead requests paused for §6${seconds}s§e due to rate limiting.")
    }

    fun onServerRetryAfter(duration: Duration) {
        if (serverCooldownNotified) return
        serverCooldownNotified = true
        val seconds = duration.seconds.coerceAtLeast(0)
        OmniClientChat.displayChatMessage("§eBackend requested cooldown for §6${seconds}s§e.")
    }

    fun resetServerCooldownNotification() {
        serverCooldownNotified = false
    }
}
