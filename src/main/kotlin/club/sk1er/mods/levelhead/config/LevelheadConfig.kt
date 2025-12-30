package club.sk1er.mods.levelhead.config

import club.sk1er.mods.levelhead.Levelhead
import club.sk1er.mods.levelhead.bedwars.BedwarsFetcher
import club.sk1er.mods.levelhead.core.BackendMode
import club.sk1er.mods.levelhead.core.GameMode
import cc.polyfrost.oneconfig.config.Config
import cc.polyfrost.oneconfig.config.annotations.Button
import cc.polyfrost.oneconfig.config.annotations.Dropdown
import cc.polyfrost.oneconfig.config.annotations.Header
import cc.polyfrost.oneconfig.config.annotations.Info
import cc.polyfrost.oneconfig.config.annotations.Slider
import cc.polyfrost.oneconfig.config.annotations.Switch
import cc.polyfrost.oneconfig.config.annotations.Text
import cc.polyfrost.oneconfig.config.data.InfoType
import cc.polyfrost.oneconfig.config.data.Mod
import cc.polyfrost.oneconfig.config.data.ModType
import club.sk1er.mods.levelhead.Levelhead.jsonParser
import com.google.gson.JsonObject
import net.minecraft.client.Minecraft
import org.apache.commons.io.FileUtils
import java.awt.Desktop
import java.io.File
import java.net.URI
import java.nio.charset.StandardCharsets
import java.time.Duration
import java.util.Locale
import java.util.UUID

private const val DEFAULT_PROXY_URL = "https://bedwars-level-head.onrender.com/"
private const val _MIN_STAR_CACHE_TTL_MINUTES = 5
private const val _MAX_STAR_CACHE_TTL_MINUTES = 180
private const val _DEFAULT_STAR_CACHE_TTL_MINUTES = 45
private const val _MIN_STAR_CACHE_TTL_MINUTES_SLIDER = 5f
private const val _MAX_STAR_CACHE_TTL_MINUTES_SLIDER = 180f
private const val GITHUB_REPO_URL = "https://github.com/beenycool/bedwars-level-head"
private const val UPSTREAM_LEVELHEAD_URL = "https://github.com/Sk1erLLC/Levelhead"
private const val MODRINTH_URL = "https://modrinth.com/mod/bedwars-level-head"
private const val DISCORD_URL = "https://discord.gg/hypixel"
private const val WIKI_URL = "https://github.com/beenycool/bedwars-level-head/wiki"
private const val CHANGELOG_URL = "https://github.com/beenycool/bedwars-level-head/releases"
private const val ABOUT_VERSION_TEXT = "Version: " + Levelhead.VERSION

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


    // ===============================
    // About Section
    // ===============================
    @Header(text = "About", category = "About")
    @Info(
        text = "BedWars Levelhead shows BedWars stars above players' heads on Hypixel.",
        type = InfoType.INFO,
        category = "About"
    )
    @Transient
    var aboutDescription: String = ""

    @Info(
        text = ABOUT_VERSION_TEXT,
        type = InfoType.INFO,
        category = "About"
    )
    @Transient
    var aboutVersion: String = ""

    @Info(
        text = "This mod is lovingly maintained and built on the shoulders of giants - huge thanks to the original Levelhead team at Sk1er LLC for creating the foundation that made all this possible.",
        type = InfoType.INFO,
        category = "About"
    )
    @Transient
    var aboutCredits: String = ""

    @Info(
        text = "Contributors: Sk1er, boomboompower, FalseHonesty, Sychic, Sk1erLLC, beenycool",
        type = InfoType.INFO,
        category = "About"
    )
    @Transient
    var aboutContributors: String = ""

    @Info(
        text = "Licensed under the GNU GPL v3 - free as in freedom, just like the spirit of Minecraft modding should be!",
        type = InfoType.INFO,
        category = "About"
    )
    @Transient
    var aboutLicense: String = ""

    @Header(text = "Links", category = "About")
    @Transient
    var linksHeader: String = ""

    @Button(
        name = "Modrinth",
        text = "Download Here",
        description = "Grab the latest version from Modrinth - the best place to get mods!",
        category = "About"
    )
    fun openModrinth() = openUrl(MODRINTH_URL)

    @Button(
        name = "Source Code",
        text = "View on GitHub",
        description = "Check out the code, contribute, or just see how the magic happens!",
        category = "About"
    )
    fun openSource() = openUrl(GITHUB_REPO_URL)

    @Button(
        name = "Original Levelhead",
        text = "Meet the Original",
        description = "Pay respects to the legendary original Levelhead mod that started it all.",
        category = "About"
    )
    fun openUpstream() = openUrl(UPSTREAM_LEVELHEAD_URL)

    @Button(
        name = "Changelog",
        text = "What's New?",
        description = "See what's changed, what's fixed, and what's coming next!",
        category = "About"
    )
    fun openChangelog() = openUrl(CHANGELOG_URL)

    @Button(
        name = "Documentation",
        text = "How to Use",
        description = "New to the mod? Check out the setup guide and tips!",
        category = "About"
    )
    fun openWiki() = openUrl(WIKI_URL)

    // ===============================
    // Display Settings Section
    // ===============================
    @Header(text = "Display Settings", category = "Display")
    @Switch(
        name = "Enable Levelhead",
        description = "Enable or disable the levelhead display entirely.",
        category = "Display"
    )
    var levelheadEnabled: Boolean = true
        set(value) {
            field = value
            Levelhead.displayManager.setEnabled(value)
        }

    @Dropdown(
        name = "Display Position",
        description = "Choose whether to display the levelhead above or below the player's nametag.",
        category = "Display",
        options = ["Above Nametag", "Below Nametag"]
    )
    var displayPositionIndex: Int = 0
        set(value) {
            field = value
            Levelhead.displayManager.config.displayPosition =
                MasterConfig.DisplayPosition.entries.getOrNull(value) ?: MasterConfig.DisplayPosition.ABOVE
            Levelhead.displayManager.saveConfig()
        }

    @Switch(
        name = "Show Self",
        description = "Display your own levelhead above your head.",
        category = "Display"
    )
    var showSelf: Boolean = true
        set(value) {
            field = value
            Levelhead.displayManager.updatePrimaryDisplay { config ->
                config.showSelf = value
                true
            }
        }

    // ===============================
    // General Settings Section
    // ===============================
    @Header(text = "General Settings")
    
    @Info(
        text = "Enter your Hypixel API key to fetch fresh stats directly from Hypixel. Get one at developer.hypixel.net",
        type = InfoType.INFO
    )
    @Transient
    var apiKeyInfo: String = ""
    
    @Text(
        name = "Hypixel API Key", 
        placeholder = "Paste your API key here (get one from developer.hypixel.net)", 
        secure = true,
        description = "Your Hypixel API key. Required for Direct API mode and to contribute to the community database."
    )
    var apiKey: String = ""

    @Dropdown(
        name = "Backend Mode",
        description = "Choose how stats are fetched. Community API uses shared database (fastest), Own API Key uses your key (most accurate), Fallback tries both (recommended), Offline uses only cached data.",
        options = ["Community API", "Own API Key", "Fallback (Recommended)", "Offline Mode"]
    )
    var backendModeIndex: Int = 2 // Default to Fallback
        set(value) {
            field = value
            save()
            BedwarsFetcher.resetWarnings()
        }

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
        set(value) {
            field = value
            save()
            BedwarsFetcher.resetWarnings()
        }

    /**
     * Get the current BackendMode based on the dropdown selection.
     */
    val backendMode: BackendMode
        get() = BackendMode.fromIndex(backendModeIndex)

    @Header(text = "Developer Options", category = "Developer")
    @Switch(
        name = "Use Proxy",
        description = "Developer option: route requests through the Levelhead backend. Do not change this unless you know what you are doing.",
        category = "Developer"
    )
    var proxyEnabled: Boolean = false

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
        min = _MIN_STAR_CACHE_TTL_MINUTES_SLIDER,
        max = _MAX_STAR_CACHE_TTL_MINUTES_SLIDER,
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
     * Returns true if the user is using the default shared backend (bedwars-level-head.onrender.com).
     * When using the shared backend, community database is compulsory.
     */
    fun isUsingSharedBackend(): Boolean {
        val trimmed = proxyBaseUrl.trim()
        val defaultTrimmed = DEFAULT_PROXY_URL.trim()
        return trimmed.isEmpty() || trimmed == defaultTrimmed || trimmed.removeSuffix("/") == defaultTrimmed.removeSuffix("/")
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
        proxyEnabled = false
        proxyBaseUrl = DEFAULT_PROXY_URL
        proxyAuthToken = ""
        communitySubmitSecret = ""
        customDatabaseUrl = ""
        starCacheTtlMinutes = DEFAULT_STAR_CACHE_TTL_MINUTES
        levelheadEnabled = true
        displayPositionIndex = 0
        showSelf = true
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

    private fun openUrl(url: String) {
        try {
            if (!Desktop.isDesktopSupported() || !Desktop.getDesktop().isSupported(Desktop.Action.BROWSE)) {
                Levelhead.sendChat("§eOpen this link in your browser: §b$url")
                return
            }
            Desktop.getDesktop().browse(URI(url))
        } catch (e: Exception) {
            Levelhead.sendChat("§cFailed to open link. §eOpen it manually: §b$url")
            Levelhead.logger.debug("Failed to open URL: {}", url, e)
        }
    }
}
