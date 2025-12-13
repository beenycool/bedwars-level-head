package club.sk1er.mods.levelhead.config

import club.sk1er.mods.levelhead.Levelhead
import club.sk1er.mods.levelhead.bedwars.BedwarsFetcher
import cc.polyfrost.oneconfig.config.Config
import cc.polyfrost.oneconfig.config.annotations.Button
import cc.polyfrost.oneconfig.config.annotations.Header
import cc.polyfrost.oneconfig.config.annotations.Slider
import cc.polyfrost.oneconfig.config.annotations.Switch
import cc.polyfrost.oneconfig.config.annotations.Text
import cc.polyfrost.oneconfig.config.data.Mod
import cc.polyfrost.oneconfig.config.data.ModType
import club.sk1er.mods.levelhead.Levelhead.jsonParser
import com.google.gson.JsonObject
import net.minecraft.client.Minecraft
import org.apache.commons.io.FileUtils
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

    @Switch(
        name = "Show Tab Stats",
        description = "Display FKDR next to player names in the Tab list."
    )
    var showTabStats: Boolean = true



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

    @Header(text = "Star Cache Settings", category = "Developer")
    @Slider(
        name = "Star Cache TTL (minutes)",
        description = "How long to cache player stars before refreshing. Higher values reduce API calls but may show outdated data.",
        category = "Developer",
        min = _MIN_STAR_CACHE_TTL_MINUTES,
        max = _MAX_STAR_CACHE_TTL_MINUTES,
        step = 1
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
        apiKey = ""
        communityDatabase = true
        showTabStats = true
        proxyEnabled = true
        proxyBaseUrl = DEFAULT_PROXY_URL
        proxyAuthToken = ""
        communitySubmitSecret = ""
        customDatabaseUrl = ""
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
