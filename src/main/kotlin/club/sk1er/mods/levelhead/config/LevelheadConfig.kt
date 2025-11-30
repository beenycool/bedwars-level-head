package club.sk1er.mods.levelhead.config

import club.sk1er.mods.levelhead.Levelhead
import club.sk1er.mods.levelhead.bedwars.BedwarsFetcher
import cc.polyfrost.oneconfig.config.Config
import cc.polyfrost.oneconfig.config.annotations.Button
import cc.polyfrost.oneconfig.config.annotations.Color
import cc.polyfrost.oneconfig.config.annotations.Header
import cc.polyfrost.oneconfig.config.annotations.Slider
import cc.polyfrost.oneconfig.config.annotations.Switch
import cc.polyfrost.oneconfig.config.annotations.Text
import cc.polyfrost.oneconfig.config.core.OneColor
import cc.polyfrost.oneconfig.config.data.Mod
import cc.polyfrost.oneconfig.config.data.ModType
import club.sk1er.mods.levelhead.Levelhead.jsonParser
import com.google.gson.JsonObject
import com.google.gson.annotations.SerializedName
import net.minecraft.client.Minecraft
import org.apache.commons.io.FileUtils
import java.awt.Color
import java.io.File
import java.nio.charset.StandardCharsets
import java.time.Duration
import java.util.Locale
import java.util.UUID

object LevelheadConfig : Config(Mod("BedWars Levelhead", ModType.HYPIXEL), "bedwars-levelhead.json") {
    private const val DEFAULT_PROXY_URL = "https://beeny.hackclub.app"

    const val MIN_STAR_CACHE_TTL_MINUTES = 5
    const val MAX_STAR_CACHE_TTL_MINUTES = 180
    const val DEFAULT_STAR_CACHE_TTL_MINUTES = 45
    @Header(text = "General")
    @Switch(name = "Enabled", description = "Toggle the BedWars Levelhead overlay")
    @SerializedName("bedwarsEnabled")
    var enabled: Boolean = true

    @Text(name = "Hypixel API Key", placeholder = "Get a key from developer.hypixel.net", secure = true)
    var apiKey: String = ""

    @Header(text = "Display Settings", category = "Display")

    @Slider(
        name = "Text Scale",
        min = 0.5f,
        max = 3.0f,
        step = 25,
        category = "Display",
        description = "Adjust the size of the BedWars star text above player heads."
    )
    var textScale: Float = 1.0f

    @Color(
        name = "Star Color",
        category = "Display",
        description = "Override the default prestige color for the star display. Leave at gold for default behavior."
    )
    var starColor: OneColor = OneColor(255, 215, 0) // Default Gold

    @Switch(
        name = "Use Custom Color",
        category = "Display",
        description = "When enabled, uses the custom Star Color instead of prestige-based colors."
    )
    var useCustomColor: Boolean = false

    @Switch(
        name = "Show Self",
        category = "Display",
        description = "Toggle showing your own levelhead above your head."
    )
    var showSelf: Boolean = true
        get() = Levelhead.displayManager.primaryDisplay()?.config?.showSelf ?: true
        set(value) {
            field = value
            Levelhead.displayManager.updatePrimaryDisplay { config ->
                val changed = config.showSelf != value
                config.showSelf = value
                changed
            }
            save()
        }

    @Slider(
        name = "Display Offset",
        min = -2.0f,
        max = 2.0f,
        step = 10,
        category = "Display",
        description = "Vertical position adjustment for the levelhead display."
    )
    var displayOffset: Float = 0.0f
        get() = Levelhead.displayManager.config.offset.toFloat()
        set(value) {
            field = value.coerceIn(-2.0f, 2.0f)
            Levelhead.displayManager.config.offset = field.toDouble()
            Levelhead.displayManager.saveConfig()
            save()
        }

    @Slider(
        name = "Render Distance",
        min = 16f,
        max = 128f,
        step = 8,
        category = "Display",
        description = "Maximum distance (in blocks) to render levelhead tags."
    )
    var renderDistance: Int = 64
        get() = Levelhead.displayManager.config.renderDistance
        set(value) {
            field = value.coerceIn(16, 128)
            Levelhead.displayManager.config.renderDistance = field
            Levelhead.displayManager.saveConfig()
            save()
        }

    @Slider(
        name = "Background Opacity",
        min = 0f,
        max = 100f,
        step = 5,
        category = "Display",
        description = "Background transparency percentage (0 = transparent, 100 = opaque)."
    )
    var backgroundOpacity: Float = 25.0f
        get() = (Levelhead.displayManager.config.backgroundOpacity * 100f).coerceIn(0f, 100f)
        set(value) {
            field = value.coerceIn(0f, 100f)
            Levelhead.displayManager.config.backgroundOpacity = (field / 100f).coerceIn(0f, 1f)
            Levelhead.displayManager.saveConfig()
            save()
        }

    @Switch(
        name = "Show Background",
        category = "Display",
        description = "Toggle the semi-transparent background behind the text."
    )
    var showBackground: Boolean = true
        get() = Levelhead.displayManager.config.showBackground
        set(value) {
            field = value
            Levelhead.displayManager.config.showBackground = value
            Levelhead.displayManager.saveConfig()
            save()
        }

    @Header(text = "Text Customization", category = "Text")
    
    @Text(
        name = "Header Text",
        category = "Text",
        description = "Customize the header text displayed before the star value."
    )
    var headerText: String = "BedWars"
        get() = Levelhead.displayManager.primaryDisplay()?.config?.headerString ?: "BedWars"
        set(value) {
            field = value.trim()
            Levelhead.displayManager.updatePrimaryDisplay { config ->
                val changed = config.headerString != field
                config.headerString = field
                changed
            }
            save()
        }

    @Color(
        name = "Header Color",
        category = "Text",
        description = "Color for the header text."
    )
    var headerColor: OneColor = OneColor(85, 255, 255)
        get() {
            val color = Levelhead.displayManager.primaryDisplay()?.config?.headerColor
            return if (color != null) {
                OneColor(color.red, color.green, color.blue)
            } else {
                OneColor(85, 255, 255)
            }
        }
        set(value) {
            field = value
            val javaColor = java.awt.Color(value.rgb)
            Levelhead.displayManager.updatePrimaryDisplay { config ->
                val changed = config.headerColor != javaColor
                config.headerColor = javaColor
                changed
            }
            save()
        }

    @Text(
        name = "Footer Template",
        category = "Text",
        description = "Footer template with placeholders: %star% (star value), %fkdr% (FKDR), %ws% (winstreak)."
    )
    var footerTemplate: String = "%star%"
        get() = Levelhead.displayManager.primaryDisplay()?.config?.footerString ?: "%star%"
        set(value) {
            field = value.trim()
            Levelhead.displayManager.updatePrimaryDisplay { config ->
                val changed = config.footerString != field
                config.footerString = field
                changed
            }
            save()
        }

    @Header(text = "Performance", category = "Performance")
    
    @Slider(
        name = "Cache Purge Size",
        min = 100f,
        max = 2000f,
        step = 50,
        category = "Performance",
        description = "Maximum cache entries before purging old entries."
    )
    var cachePurgeSize: Int = 500
        get() = Levelhead.displayManager.config.purgeSize
        set(value) {
            field = value.coerceIn(100, 2000)
            Levelhead.displayManager.config.purgeSize = field
            Levelhead.displayManager.saveConfig()
            save()
        }

    @Slider(
        name = "Render Throttle (ms)",
        min = 0f,
        max = 100f,
        step = 5,
        category = "Performance",
        description = "Minimum time between render updates per player (0 = no throttling)."
    )
    var renderThrottleMs: Long = 0L
        get() = Levelhead.displayManager.config.renderThrottleMs
        set(value) {
            field = value.coerceIn(0L, 100L)
            Levelhead.displayManager.config.renderThrottleMs = field
            Levelhead.displayManager.saveConfig()
            save()
        }

    @Header(text = "Developer Options", category = "Developer")
    @Switch(
        name = "Use Proxy",
        description = "Developer option: route requests through the Levelhead backend. Do not change this unless you know what you are doing.",
        category = "Developer"
    )
    var proxyEnabled: Boolean = true

    @Text(
        name = "Proxy Base URL",
        placeholder = DEFAULT_PROXY_URL,
        description = "Developer option: backend base URL. Do not change this unless you know what you are doing.",
        category = "Developer"
    )
    var proxyBaseUrl: String = DEFAULT_PROXY_URL

    @Text(
        name = "Proxy Auth Token",
        secure = true,
        description = "Developer option: authentication token. Do not change this unless you know what you are doing.",
        category = "Developer"
    )
    var proxyAuthToken: String = ""

    @Slider(
        name = "Star Cache TTL (minutes)",
        min = 5f,
        max = 180f,
        step = 1,
        category = "Developer",
        description = "Developer option: adjust cache duration. Do not change this unless you know what you are doing."
    )
    var starCacheTtlMinutes: Int = DEFAULT_STAR_CACHE_TTL_MINUTES

    @Button(
        name = "Reset Settings",
        text = "Reset to Defaults",
        description = "Restore BedWars Levelhead settings to their defaults."
    )
    fun resetToDefaultsButton() {
        resetToDefaults()
    }

    var welcomeMessageShown: Boolean = false

    var installId: String = ""

    val starCacheTtl: Duration
        get() = Duration.ofMinutes(starCacheTtlMinutes.coerceIn(MIN_STAR_CACHE_TTL_MINUTES, MAX_STAR_CACHE_TTL_MINUTES).toLong())

    init {
        initialize()
        migrateLegacyConfig()
        ensureInstallId()
    }

    private fun migrateLegacyConfig() {
        try {
            val configFile = File(File(Minecraft.getMinecraft().mcDataDir, "config"), "bedwars-levelhead.json")
            if (!configFile.exists()) return

            val jsonContent = FileUtils.readFileToString(configFile, StandardCharsets.UTF_8)
            val json = jsonParser.parse(jsonContent)
            if (!json.isJsonObject) return

            val jsonObj = json.asJsonObject
            var migrated = false

            // Migrate "enabled" -> "bedwarsEnabled"
            if (jsonObj.has("enabled") && !jsonObj.has("bedwarsEnabled")) {
                val enabledValue = jsonObj.get("enabled")
                jsonObj.add("bedwarsEnabled", enabledValue)
                jsonObj.remove("enabled")
                migrated = true
            }

            if (migrated) {
                FileUtils.writeStringToFile(configFile, jsonObj.toString(), StandardCharsets.UTF_8)
                // Reload the config after migration
                initialize()
            }
        } catch (e: Exception) {
            Levelhead.logger.warn("Failed to migrate legacy config", e)
        }
    }

    private fun ensureInstallId() {
        if (installId.isBlank()) {
            installId = UUID.randomUUID().toString().replace("-", "").lowercase(Locale.ROOT)
            save()
        }
    }

    fun markWelcomeMessageShown() {
        if (!welcomeMessageShown) {
            welcomeMessageShown = true
            save()
        }
    }

    fun updateApiKey(newKey: String) {
        apiKey = newKey.trim()
        save()
        BedwarsFetcher.resetWarnings()
    }

    fun clearApiKey() {
        if (apiKey.isNotBlank()) {
            apiKey = ""
            save()
            BedwarsFetcher.resetWarnings()
        }
    }

    fun updateProxyEnabled(enabled: Boolean) {
        proxyEnabled = enabled
        save()
        BedwarsFetcher.resetWarnings()
    }

    fun updateProxyBaseUrl(url: String) {
        proxyBaseUrl = url.trim()
        save()
        BedwarsFetcher.resetWarnings()
    }

    fun updateProxyAuthToken(token: String) {
        proxyAuthToken = token.trim()
        save()
        BedwarsFetcher.resetWarnings()
    }

    private fun resetToDefaults() {
        enabled = true
        apiKey = ""
        textScale = 1.0f
        starColor = OneColor(255, 215, 0)
        useCustomColor = false
        showSelf = true
        displayOffset = 0.0f
        renderDistance = 64
        backgroundOpacity = 25.0f
        showBackground = true
        headerText = "BedWars"
        headerColor = OneColor(85, 255, 255)
        footerTemplate = "%star%"
        cachePurgeSize = 500
        renderThrottleMs = 0L
        proxyEnabled = true
        proxyBaseUrl = DEFAULT_PROXY_URL
        proxyAuthToken = ""
        starCacheTtlMinutes = DEFAULT_STAR_CACHE_TTL_MINUTES
        save()
        BedwarsFetcher.resetWarnings()
        Levelhead.displayManager.resetToDefaults()
    }

    fun updateStarCacheTtlMinutes(minutes: Int) {
        val clamped = minutes.coerceIn(MIN_STAR_CACHE_TTL_MINUTES, MAX_STAR_CACHE_TTL_MINUTES)
        starCacheTtlMinutes = clamped
        save()
        BedwarsFetcher.resetWarnings()
    }
}
