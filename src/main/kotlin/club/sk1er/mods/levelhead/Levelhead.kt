package club.sk1er.mods.levelhead

import club.sk1er.mods.levelhead.bedwars.BedwarsFetcher
import club.sk1er.mods.levelhead.config.ApiKeyStore
import club.sk1er.mods.levelhead.config.LevelheadConfig
import club.sk1er.mods.levelhead.config.DisplayConfig
import club.sk1er.mods.levelhead.config.MasterConfig
import club.sk1er.mods.levelhead.core.BedwarsModeDetector
import club.sk1er.mods.levelhead.core.DisplayManager
import club.sk1er.mods.levelhead.core.BedwarsStar
import club.sk1er.mods.levelhead.core.dashUUID
import club.sk1er.mods.levelhead.display.LevelheadDisplay
import club.sk1er.mods.levelhead.display.AboveHeadDisplay
import club.sk1er.mods.levelhead.commands.LevelheadCommand
import club.sk1er.mods.levelhead.render.AboveHeadRender
import club.sk1er.mods.levelhead.util.Bedwars
import com.google.gson.Gson
import net.minecraft.client.Minecraft
import net.minecraft.client.settings.GameSettings
import net.minecraft.client.settings.KeyBinding
import net.minecraftforge.common.MinecraftForge
import net.minecraftforge.fml.client.registry.ClientRegistry
import net.minecraftforge.fml.common.Loader
import net.minecraftforge.fml.common.Mod
import net.minecraftforge.fml.common.event.FMLInitializationEvent
import net.minecraftforge.fml.common.event.FMLPreInitializationEvent
import net.minecraftforge.fml.relauncher.Side
import net.minecraftforge.fml.relauncher.SideOnly
import org.polyfrost.oneconfig.api.events.EventManager
import org.polyfrost.oneconfig.api.mod.OneConfigMod
import org.polyfrost.oneconfig.api.platform.v1.Platform
import org.polyfrost.oneconfig.api.config.v1.Config
import java.io.File
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit
import okhttp3.OkHttpClient
import java.time.Duration

@Mod(modid = "levelhead", version = "2.0.0", clientSideOnly = true, modid = "levelhead", version = "2.0.0", clientSideOnly = true)
@SideOnly(Side.CLIENT)
object Levelhead : OneConfigMod("levelhead") {
    
    // Keep the old properties for compatibility
    const val VERSION = "2.0.0"
    const val MODID = "levelhead"
    
    // Logger for compatibility
    private val loggerImpl = org.apache.logging.log4j.LogManager.getLogger("Levelhead")
    val logger = object {
        fun error(msg: String, vararg args: Any?) = loggerImpl.error(msg, *args)
        fun warn(msg: String, vararg args: Any?) = loggerImpl.warn(msg, *args)
        fun info(msg: String, vararg args: Any?) = loggerImpl.info(msg, *args)
        fun debug(msg: String, vararg args: Any?) = loggerImpl.debug(msg, *args)
    }
    
    // HTTP client and JSON parser for compatibility
    val okHttpClient = okhttp3.OkHttpClient.Builder()
        .connectTimeout(5, TimeUnit.SECONDS)
        .readTimeout(5, TimeUnit.SECONDS)
        .writeTimeout(5, TimeUnit.SECONDS)
        .build()
    
    val gson = com.google.gson.Gson()
    val jsonParser = com.google.gson.JsonParser()
    
    // Simplified rate limiter for compatibility
    val rateLimiter = club.sk1er.mods.levelhead.core.RateLimiter(150, java.time.Duration.ofMinutes(5))
    
    // Placeholder methods for compatibility
    fun fetch(requests: List<LevelheadRequest>) {
        // Simplified - just log the requests for now
        // In a full implementation, this would trigger the display updates
        println("Levelhead: Processing ${requests.size} fetch requests")
    }
    
    fun clearCachedStars() {
        // Simplified - clear any cached data
        println("Levelhead: Clearing cached stars")
    }
    
    @Config(title = "Levelhead", description = "BedWars Levelhead Configuration")
    object ConfigHandler {
        // This is just a marker class - the actual config is in the LevelheadConfig object
    }
    
    // Public properties for access by other classes
    var bedwarsFetcher: BedwarsFetcher? = null
    var displayManager: DisplayManager? = null
    var bedwarsModeDetector: BedwarsModeDetector? = null
    var bedwarsStar: BedwarsStar? = null
    
    private val scheduler: ScheduledExecutorService = Executors.newScheduledThreadPool(4)
    private var updateThread: Thread? = null
    private val updateRunnable = Runnable {
        while (updateThread == Thread.currentThread()) {
            try {
                if (Minecraft.getMinecraft().thePlayer != null && MasterConfig.enabled) {
                    bedwarsFetcher?.update()
                }
                Thread.sleep(1000)
            } catch (e: InterruptedException) {
                break
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }
    }

    @Mod.EventHandler
    fun preInit(event: FMLPreInitializationEvent) {
        // Initialize OneConfig
        OneConfigMod.initialize()
        
        // Register commands
        LevelheadCommand.register()
        
        // Initialize API key store
        val configDir = File(event.modConfigurationDirectory, "levelhead")
        if (!configDir.exists()) {
            configDir.mkdirs()
        }
        val apiKeyFile = File(configDir, "apikey.json")
        ApiKeyStore.initialize(apiKeyFile)
        
        // Initialize display system
        displayManager = DisplayManager()
        bedwarsFetcher = BedwarsFetcher(this)
        bedwarsModeDetector = BedwarsModeDetector(this)
        bedwarsStar = BedwarsStar(this)
    }

    @Mod.EventHandler
    fun init(event: FMLInitializationEvent) {
        // Register event handlers
        setupEventHandlers()
        
        // Register keybind
        registerKeybind()
        
        // Initialize API key from OneConfig if not already loaded
        val apiKey = LevelheadConfig.General.getApiKey()
        if (apiKey.isNotEmpty() && !apiKey.contentEquals(placeholder)) {
            ApiKeyStore.setApiKey(apiKey)
        }
        
        // Register for configuration updates
        EventManager.subscribe(this::class.java, this::onConfigUpdate)
        
        // Start update thread
        startUpdateThread()
        
        println("BedWars Levelhead mod initialized successfully")
    }

    private fun setupEventHandlers() {
        // Register Forge events
        MinecraftForge.EVENT_BUS.register(AboveHeadRender())
        MinecraftForge.EVENT_BUS.register(BedwarsModeDetector(this))
        MinecraftForge.EVENT_BUS.register(DisplayManager())
        
        // Register OneConfig events
        EventManager.subscribe("levelhead.tick", this::onTick)
        EventManager.subscribe("levelhead.render", this::onRender)
        EventManager.subscribe("levelhead.config", this::onConfigChange)
    }

    private fun registerKeybind() {
        try {
            val keybind = KeyBinding("Toggle Levelhead", 0, "BedWars Levelhead")
            ClientRegistry.registerKeyBinding(keybind)
            
            // Register keypress event
            EventManager.subscribe("levelhead.keypress", this::onKeyPress)
        } catch (e: Exception) {
            println("Failed to register keybind: ${e.message}")
        }
    }

    private fun onTick() {
        if (Minecraft.getMinecraft().thePlayer == null || !MasterConfig.enabled) {
            return
        }
        
        val player = Minecraft.getMinecraft().thePlayer
        val worldName = Bedwars.getWorldName(player.worldScoreboard) ?: return
        
        // Update display based on current mode
        val mode = bedwarsModeDetector?.getCurrentMode() ?: return
        if (!bedwarsModeDetector?.isInGame() ?: return) {
            return
        }
        
        // Update player displays
        updatePlayerDisplays()
    }

    private fun onRender() {
        if (!MasterConfig.enabled || !DisplayConfig.enabled) {
            return
        }
        
        // Rendering is handled by AboveHeadRender class
    }

    private fun onConfigChange() {
        // Handle configuration changes
        if (!MasterConfig.enabled) {
            displayManager?.clearAll()
        }
        
        // Update API key in secure store
        val currentKey = ApiKeyStore.getApiKey() ?: ""
        val newKey = LevelheadConfig.General.getApiKey()
        if (currentKey != newKey && newKey.isNotEmpty() && newKey != placeholder) {
            ApiKeyStore.setApiKey(newKey)
        }
    }

    private fun onConfigUpdate(configData: Any?) {
        // Handle OneConfig configuration updates
        onConfigChange()
    }

    private fun onKeyPress(keyCode: Int) {
        if (keyCode == GameSettings.getKeyDisplayOfFunction()?.keyCode) {
            // Toggle display
            DisplayConfig.enabled = !DisplayConfig.enabled
        }
    }

    private fun updatePlayerDisplays() {
        val player = Minecraft.getMinecraft().thePlayer ?: return
        if (player.worldScoreboard == null) return
        
        val worldName = Bedwars.getWorldName(player.worldScoreboard) ?: return
        val mode = bedwarsModeDetector?.getCurrentMode() ?: return
        
        // Update all player displays in the world
        for (otherPlayer in player.world.getEntityList()) {
            if (otherPlayer is net.minecraft.entity.player.EntityPlayer && otherPlayer != player) {
                updatePlayerDisplay(otherPlayer, mode)
            }
        }
    }

    private fun updatePlayerDisplay(player: net.minecraft.entity.player.EntityPlayer, mode: String) {
        val name = player.getName()
        val level = bedwarsFetcher?.getLevel(name) ?: return
        
        // Skip if showing self is disabled and it's the local player
        if (!DisplayConfig.showSelf && player == Minecraft.getMinecraft().thePlayer) {
            return
        }
        
        // Format and display the level
        val displayText = formatLevelDisplay(level, mode)
        if (displayText != null) {
            displayManager?.setDisplay(player.getName(), displayText)
        }
    }

    private fun formatLevelDisplay(level: Int, mode: String): String? {
        if (!DisplayConfig.enabled) return null
        
        val color = when {
            level < DisplayConfig.starThreshold -> "§7"
            level < DisplayConfig.legendThreshold -> "§b"
            level < DisplayConfig.grandmasterThreshold -> "§a"
            level < DisplayConfig.gemThreshold -> "§d"
            else -> "§5"
        }
        
        val prefix = when {
            level >= DisplayConfig.gemThreshold -> "§d[§5Gem§d] §5$level"
            level >= DisplayConfig.grandmasterThreshold -> "§a[§2GM§a] §a$level"
            level >= DisplayConfig.legendThreshold -> "§b[§9LEGEND§b] §9$level"
            level >= DisplayConfig.starThreshold -> "§6★ §e$level"
            else -> "§7$level"
        }
        
        return if (DisplayConfig.showType) {
            "§8[§7${mode.uppercase()}§8] $prefix"
        } else {
            prefix
        }
    }

    private fun startUpdateThread() {
        updateThread = Thread(updateRunnable, "Levelhead-UpdateThread")
        updateThread?.isDaemon = true
        updateThread?.start()
    }

    private fun stopUpdateThread() {
        updateThread?.interrupt()
        updateThread = null
    }

    override fun onConfigSaved() {
        // OneConfig will call this when configuration is saved
        onConfigChange()
    }
    
    // Data class for compatibility
    data class LevelheadRequest(
        val uuid: String, 
        val display: club.sk1er.mods.levelhead.display.LevelheadDisplay, 
        val allowOverride: Boolean
    )
    
    // Placeholder for rate limiter methods
    fun resetRateLimiterNotification() {
        rateLimiter.resetState()
    }
    
    fun onServerRetryAfter(duration: Duration) {
        rateLimiter.registerServerCooldown(duration)
    }
    
    fun resetServerCooldownNotification() {
        // Reset cooldown notification
    }
}
