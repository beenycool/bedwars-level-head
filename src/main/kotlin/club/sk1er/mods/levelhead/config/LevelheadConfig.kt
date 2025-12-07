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
import java.awt.Color as AwtColor
import java.io.File
import java.nio.charset.StandardCharsets
import java.time.Duration
import java.util.Locale
import java.util.UUID

private const val DEFAULT_PROXY_URL = "https://beeny.hackclub.app"
private const val _MIN_STAR_CACHE_TTL_MINUTES = 5
private const val _MAX_STAR_CACHE_TTL_MINUTES = 180
private const val _DEFAULT_STAR_CACHE_TTL_MINUTES = 45

object LevelheadConfig : Config(Mod("BedWars Levelhead", ModType.HYPIXEL), "bedwars-levelhead.json") {
    // Expose constants as @JvmStatic functions - functions are not serialized by Gson
    @JvmStatic
    fun getMinStarCacheTtlMinutes() = _MIN_STAR_CACHE_TTL_MINUTES
    
    @JvmStatic
    fun getMaxStarCacheTtlMinutes() = _MAX_STAR_CACHE_TTL_MINUTES
    
    @JvmStatic
    fun getDefaultStarCacheTtlMinutes() = _DEFAULT_STAR_CACHE_TTL_MINUTES
    
    // Provide property-like access for Kotlin (computed properties compile to methods, not fields)
    val MIN_STAR_CACHE_TTL_MINUTES: Int get() = _MIN_STAR_CACHE_TTL_MINUTES
    val MAX_STAR_CACHE_TTL_MINUTES: Int get() = _MAX_STAR_CACHE_TTL_MINUTES
    val DEFAULT_STAR_CACHE_TTL_MINUTES: Int get() = _DEFAULT_STAR_CACHE_TTL_MINUTES

    @Header(text = "General")
    @Switch(name = "Enabled", description = "Toggle the BedWars Levelhead overlay")
    @SerializedName("bedwarsEnabled")
    var enabled: Boolean = true

    @Text(name = "Hypixel API Key", placeholder = "Get a key from developer.hypixel.net", secure = true)
    var apiKey: String = ""

    @Switch(
        name = "Community Database",
        description = "Fetch stats from the community cache to save API requests. When you have an API key, your lookups will also contribute to the shared cache."
    )
    var communityDatabase: Boolean = true
        set(value) {
            if (value && apiKey.isBlank()) {
                Levelhead.sendChat("§eYou need a Hypixel API key to contribute to the community database. §7You can still fetch cached data.")
            }
            field = value
            save()
            BedwarsFetcher.resetWarnings()
        }

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
        set(value) {
            val clamped = value.coerceIn(0.5f, 3.0f)
            field = clamped
            syncFontSizeWithDisplayManager(clamped)
            save()
        }

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
        set(value) {
            field = value
            Levelhead.displayManager.updatePrimaryDisplay { config ->
                config.showSelf = value
                true
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
        set(value) {
            field = value
            Levelhead.displayManager.config.showBackground = value
            Levelhead.displayManager.saveConfig()
            save()
        }

    @Switch(
        name = "Text Shadow",
        category = "Display",
        description = "Add shadow to text. Disable to match Patcher nametag settings with shadow off."
    )
    var textShadow: Boolean = false
        set(value) {
            field = value
            Levelhead.displayManager.config.textShadow = value
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
        set(value) {
            field = value.trim()
            Levelhead.displayManager.updatePrimaryDisplay { config ->
                config.headerString = field
                true
            }
            save()
        }

    @Color(
        name = "Header Color",
        category = "Text",
        description = "Color for the header text."
    )
    var headerColor: OneColor = OneColor(85, 255, 255)
        set(value) {
            field = value
            val javaColor = AwtColor(value.rgb)
            Levelhead.displayManager.updatePrimaryDisplay { config ->
                config.headerColor = javaColor
                true
            }
            save()
        }

    @Text(
        name = "Footer Template",
        category = "Text",
        description = "Footer template with placeholders: %star% (star value), %fkdr% (FKDR), %ws% (winstreak)."
    )
    var footerTemplate: String = "%star%"
        set(value) {
            field = value.trim()
            Levelhead.displayManager.updatePrimaryDisplay { config ->
                config.footerString = field
                true
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
    var renderThrottleMs: Int = 100
        set(value) {
            field = value.coerceIn(0, 100)
            Levelhead.displayManager.config.renderThrottleMs = field.toLong()
            Levelhead.displayManager.saveConfig()
            save()
        }

    @Slider(
        name = "Frame Skip",
        min = 1f,
        max = 4f,
        step = 1,
        category = "Performance",
        description = "Render tags every N frames. Higher = better FPS but slightly less smooth. At 60 FPS: 2 = 30 updates/sec, 4 = 15 updates/sec."
    )
    var frameSkip: Int = 1
        set(value) {
            field = value.coerceIn(1, 4)
            Levelhead.displayManager.config.frameSkip = field
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

    @Text(
        name = "Submission Secret",
        secure = true,
        description = "Developer option: HMAC secret for signing community submissions. Must match the backend.",
        category = "Developer"
    )
    var communitySubmitSecret: String = ""

    @Text(
        name = "Custom Database URL",
        placeholder = "Leave blank to use default",
        description = "Developer option: Override community database URL. Only works when using API key or self-hosting.",
        category = "Developer"
    )
    var customDatabaseUrl: String = ""

    @Slider(
        name = "Star Cache TTL (minutes)",
        min = 5f,
        max = 180f,
        step = 1,
        category = "Developer",
        description = "Developer option: adjust cache duration. Do not change this unless you know what you are doing."
    )
    var starCacheTtlMinutes: Int = _DEFAULT_STAR_CACHE_TTL_MINUTES

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
        get() = Duration.ofMinutes(starCacheTtlMinutes.coerceIn(_MIN_STAR_CACHE_TTL_MINUTES, _MAX_STAR_CACHE_TTL_MINUTES).toLong())

    init {
        initialize()
        migrateLegacyConfig()
        syncDisplayManagerConfig()
        ensureInstallId()
        setupConditionalVisibility()
    }

    private fun setupConditionalVisibility() {
        // Hide community database toggle when using shared backend - it's always enabled
        hideIf("communityDatabase") { isUsingSharedBackend() }
    }

    /**
     * Returns true if the user is using the default shared backend (beeny.hackclub.app).
     * When using the shared backend, community database is compulsory.
     */
    fun isUsingSharedBackend(): Boolean {
        return proxyBaseUrl.trim().isEmpty() || proxyBaseUrl.trim() == DEFAULT_PROXY_URL
    }

    /**
     * Returns true if backend warnings should be suppressed.
     * Suppress warnings when user has an API key but hasn't set a custom backend/database.
     */
    fun shouldSuppressBackendWarnings(): Boolean {
        return apiKey.isNotBlank() && isUsingSharedBackend() && customDatabaseUrl.isBlank()
    }

    /**
     * Resolves the database URL to use for community database requests.
     * Uses custom URL if set and user has API key or is self-hosting, otherwise falls back to proxy base URL.
     */
    fun resolveDbUrl(): String {
        val customUrl = customDatabaseUrl.trim()
        if (customUrl.isNotBlank()) {
            val hasApiKey = apiKey.isNotBlank()
            val isSelfHosting = !isUsingSharedBackend()
            if (hasApiKey || isSelfHosting) {
                return customUrl
            }
        }
        return proxyBaseUrl.trim().ifBlank { DEFAULT_PROXY_URL }
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
        textShadow = false
        headerText = "BedWars"
        headerColor = OneColor(85, 255, 255)
        footerTemplate = "%star%"
        cachePurgeSize = 500
        renderThrottleMs = 100
        frameSkip = 1
        communityDatabase = true
        proxyEnabled = true
        proxyBaseUrl = DEFAULT_PROXY_URL
        proxyAuthToken = ""
        communitySubmitSecret = ""
        customDatabaseUrl = ""
        starCacheTtlMinutes = DEFAULT_STAR_CACHE_TTL_MINUTES
        syncFontSizeWithDisplayManager()
        save()
        BedwarsFetcher.resetWarnings()
        Levelhead.displayManager.resetToDefaults()
    }

    private fun syncDisplayManagerConfig() {
        val master = Levelhead.displayManager.config
        var masterChanged = false

        val clampedTextScale = textScale.coerceIn(0.5f, 3.0f)
        if (sync(textScale, clampedTextScale, { textScale = it }, master.fontSize, clampedTextScale.toDouble(), { master.fontSize = it })) {
            masterChanged = true
        }

        val clampedOffset = displayOffset.coerceIn(-2.0f, 2.0f)
        if (sync(displayOffset, clampedOffset, { displayOffset = it }, master.offset, clampedOffset.toDouble(), { master.offset = it })) {
            masterChanged = true
        }

        val clampedRenderDistance = renderDistance.coerceIn(16, 128)
        if (sync(renderDistance, clampedRenderDistance, { renderDistance = it }, master.renderDistance, clampedRenderDistance, { master.renderDistance = it })) {
            masterChanged = true
        }

        val clampedBackgroundOpacity = backgroundOpacity.coerceIn(0f, 100f)
        val opacityFraction = (clampedBackgroundOpacity / 100f).coerceIn(0f, 1f)
        if (sync(backgroundOpacity, clampedBackgroundOpacity, { backgroundOpacity = it }, master.backgroundOpacity, opacityFraction, { master.backgroundOpacity = it })) {
            masterChanged = true
        }

        if (sync(showBackground, showBackground, { showBackground = it }, master.showBackground, showBackground, { master.showBackground = it })) {
            masterChanged = true
        }

        if (sync(textShadow, textShadow, { textShadow = it }, master.textShadow, textShadow, { master.textShadow = it })) {
            masterChanged = true
        }

        val clampedPurgeSize = cachePurgeSize.coerceIn(100, 2000)
        if (sync(cachePurgeSize, clampedPurgeSize, { cachePurgeSize = it }, master.purgeSize, clampedPurgeSize, { master.purgeSize = it })) {
            masterChanged = true
        }

        val clampedRenderThrottle = renderThrottleMs.coerceIn(0, 100).toLong()
        if (sync(renderThrottleMs, clampedRenderThrottle.toInt(), { renderThrottleMs = it }, master.renderThrottleMs, clampedRenderThrottle, { master.renderThrottleMs = it })) {
            masterChanged = true
        }

        val clampedFrameSkip = frameSkip.coerceIn(1, 4)
        if (sync(frameSkip, clampedFrameSkip, { frameSkip = it }, master.frameSkip, clampedFrameSkip, { master.frameSkip = it })) {
            masterChanged = true
        }

        val primaryChanged = Levelhead.displayManager.updatePrimaryDisplay { config ->
            var changed = false
            if (config.showSelf != showSelf) {
                config.showSelf = showSelf
                changed = true
            }

            val header = headerText.trim()
            if (config.headerString != header) {
                config.headerString = header
                changed = true
            }

            val javaColor = AwtColor(headerColor.rgb)
            if (config.headerColor != javaColor) {
                config.headerColor = javaColor
                changed = true
            }

            val footer = footerTemplate.trim()
            if (config.footerString != footer) {
                config.footerString = footer
                changed = true
            }

            changed
        }

        if (masterChanged && !primaryChanged) {
            Levelhead.displayManager.saveConfig()
        }
    }

    private fun <T, M> sync(
        local: T,
        localTarget: T,
        updateLocal: (T) -> Unit,
        master: M,
        masterTarget: M,
        updateMaster: (M) -> Unit
    ): Boolean {
        if (local != localTarget) {
            updateLocal(localTarget)
            return false
        }
        if (master != masterTarget) {
            updateMaster(masterTarget)
            return true
        }
        return false
    }

    private fun syncFontSizeWithDisplayManager(scale: Float = textScale) {
        Levelhead.displayManager.config.fontSize = scale.toDouble()
        Levelhead.displayManager.saveConfig()
    }

    fun updateStarCacheTtlMinutes(minutes: Int) {
        val clamped = minutes.coerceIn(MIN_STAR_CACHE_TTL_MINUTES, MAX_STAR_CACHE_TTL_MINUTES)
        starCacheTtlMinutes = clamped
        save()
        BedwarsFetcher.resetWarnings()
    }
}
