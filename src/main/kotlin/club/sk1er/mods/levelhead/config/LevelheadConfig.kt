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
import java.awt.datatransfer.StringSelection
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
private const val BACKEND_MODE_INDEX_MAX = 3
private val BACKEND_MODE_DIRECT_API = BackendMode.DIRECT_API.ordinal
private const val GITHUB_REPO_URL = "https://github.com/beenycool/bedwars-level-head"
private const val UPSTREAM_LEVELHEAD_URL = "https://github.com/Sk1erLLC/Levelhead"
private const val MODRINTH_URL = "https://modrinth.com/mod/bedwars-level-head"
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
    // Category: Quick Setup (Most users only need these)
    // ===============================
    @Header(text = "Quick Setup", category = "Quick Setup")
    @Transient
    var quickSetupHeader: String = ""

    @Info(
        text = "Configure how stats are fetched. Community API is fastest (uses shared database). Your own API key is most accurate. Fallback tries both (recommended).",
        type = InfoType.INFO,
        category = "Quick Setup"
    )
    @Transient
    var backendModeInfo: String = ""

    @Dropdown(
        name = "Backend Mode",
        description = "Choose how stats are fetched. Community API uses shared database (fastest), Own API Key uses your key (most accurate), Fallback tries both (recommended), Offline uses only cached data.",
        category = "Quick Setup",
        options = ["Community API", "Own API Key", "Fallback (Recommended)", "Offline Mode"]
    )
    var backendModeIndex: Int = 2 // Default to Fallback
        set(value) {
            val clamped = value.coerceIn(0, BACKEND_MODE_INDEX_MAX)
            field = clamped
            save()
            BedwarsFetcher.resetWarnings()
        }

    @Info(
        text = "You need a Hypixel API key when using 'Own API Key' mode. Get one at developer.hypixel.net",
        type = InfoType.WARNING,
        category = "Quick Setup"
    )
    @Transient
    var apiKeyWarning: String = ""


    @Text(
        name = "Hypixel API Key", 
        placeholder = "Paste your API key here (get one from developer.hypixel.net)", 
        secure = true,
        description = "Your Hypixel API key. Required for Direct API mode and to contribute to the community database.",
        category = "Quick Setup"
    )
    var apiKey: String = ""

    @Switch(
        name = "Show Tab Stats",
        description = "Display FKDR next to player names in the Tab list.",
        category = "Quick Setup"
    )
    var showTabStats: Boolean = true
        set(value) {
            field = value
            save()
            BedwarsFetcher.resetWarnings()
        }

    @Switch(
        name = "Enable Levelhead",
        description = "Enable or disable the levelhead display entirely.",
        category = "Quick Setup"
    )
    var levelheadEnabled: Boolean = true
        set(value) {
            field = value
            Levelhead.displayManager.setEnabled(value)
        }

    @Button(
        name = "Show Status",
        text = "Check Status",
        description = "Display current backend status, cache health, and rate limits in chat.",
        category = "Quick Setup"
    )
    fun showStatusButton() {
        val snapshot = Levelhead.statusSnapshot()
        val backendMode = backendMode.displayName

        Levelhead.sendChat("§b§lBedWars Levelhead Status")
        Levelhead.sendChat(" §7- §bBackend Mode: §e$backendMode")
        Levelhead.sendChat(" §7- §bCache Size: §e${snapshot.cacheSize} players")

        val rateLimitResetSeconds = snapshot.rateLimitResetMillis / 1000
        Levelhead.sendChat(
            " §7- §bAPI Rate Limit: §e${snapshot.rateLimitRemaining} remaining (resets in ${rateLimitResetSeconds}s)"
        )

        val lastSuccess = snapshot.lastSuccessAgeMillis?.let { "§a${it / 1000}s ago" } ?: "§cNever"
        Levelhead.sendChat(" §7- §bLast Successful Fetch: $lastSuccess")

        snapshot.serverCooldownMillis?.let {
            if (it > 0) {
                Levelhead.sendChat(" §7- §bServer Cooldown: §e${it / 1000}s remaining")
            }
        }
    }

    // ===============================
    // Category: Display (Visual customization)
    // ===============================
    @Header(text = "Display Position", category = "Display")
    @Transient
    var displayPositionHeader: String = ""

    @Dropdown(
        name = "Display Position",
        description = "Choose whether to display the levelhead above or below the player's nametag.",
        category = "Display",
        options = ["Above Nametag", "Below Nametag"]
    )
    var displayPositionIndex: Int = 0
        set(value) {
            val entries = MasterConfig.DisplayPosition.entries
            val clamped = if (entries.isNotEmpty()) {
                value.coerceIn(0, entries.lastIndex)
            } else {
                0
            }
            field = clamped
            Levelhead.displayManager.config.displayPosition =
                entries.getOrNull(clamped) ?: MasterConfig.DisplayPosition.ABOVE
            Levelhead.displayManager.saveConfig()
            save()
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
            save()
        }

    @Header(text = "Header Text", category = "Display")
    @Transient
    var headerTextHeader: String = ""

    @Text(
        name = "Header Text",
        placeholder = "e.g., BedWars Level",
        description = "The text shown before the player's level/star. Default: 'BedWars Level'",
        category = "Display"
    )
    var headerText: String = GameMode.BEDWARS.defaultHeader
        set(value) {
            field = value
            Levelhead.displayManager.updatePrimaryDisplay { config ->
                config.headerString = value
                true
            }
            save()
        }

    @Text(
        name = "Header Color",
        placeholder = "#55FFFF",
        description = "Hex color for the header text. Default: #55FFFF (cyan)",
        category = "Display"
    )
    var headerColorHex: String = "#55FFFF"
        set(value) {
            field = value
            try {
                val color = java.awt.Color.decode(value)
                Levelhead.displayManager.updatePrimaryDisplay { config ->
                    config.headerColor = color
                    true
                }
            } catch (e: NumberFormatException) {
                // Invalid color, ignore
            }
            save()
        }

    @Header(text = "Footer (Star) Text", category = "Display")
    @Transient
    var footerTextHeader: String = ""

    @Text(
        name = "Footer Format",
        placeholder = "%star%",
        description = "Format for the footer. Use %star% for prestige stars, or enter custom text. Default: %star%",
        category = "Display"
    )
    var footerFormat: String = "%star%"
        set(value) {
            field = value
            Levelhead.displayManager.updatePrimaryDisplay { config ->
                config.footerString = value
                true
            }
            save()
        }

    @Text(
        name = "Footer Color",
        placeholder = "#FFFF55",
        description = "Hex color for the footer text. Default: #FFFF55 (yellow)",
        category = "Display"
    )
    var footerColorHex: String = "#FFFF55"
        set(value) {
            field = value
            try {
                val color = java.awt.Color.decode(value)
                Levelhead.displayManager.updatePrimaryDisplay { config ->
                    config.footerColor = color
                    true
                }
            } catch (e: NumberFormatException) {
                // Invalid color, ignore
            }
            save()
        }

    // ===============================
    // Category: Appearance (Fine-tuning visual settings)
    // ===============================
    @Header(text = "Font & Position", category = "Appearance")
    @Transient
    var appearanceHeader: String = ""

    @Slider(
        name = "Font Size",
        description = "Scale factor for the display text. 1.0 is normal size.",
        category = "Appearance",
        min = 0.5f,
        max = 2.0f,
        step = 1
    )
    var fontSize: Float = 1.0f
        set(value) {
            field = value
            Levelhead.displayManager.config.fontSize = value.toDouble()
            Levelhead.displayManager.saveConfig()
            save()
        }

    @Slider(
        name = "Vertical Offset",
        description = "Fine-tune the vertical position. Negative values move it closer to the nametag.",
        category = "Appearance",
        min = -0.5f,
        max = 0.5f,
        step = 1
    )
    var verticalOffset: Float = 0.0f
        set(value) {
            field = value
            Levelhead.displayManager.config.offset = value.toDouble()
            Levelhead.displayManager.saveConfig()
            save()
        }

    @Switch(
        name = "Show Background",
        description = "Display a semi-transparent background behind the levelhead text.",
        category = "Appearance"
    )
    var showBackground: Boolean = true
        set(value) {
            field = value
            Levelhead.displayManager.config.showBackground = value
            Levelhead.displayManager.saveConfig()
            save()
        }

    @Slider(
        name = "Background Opacity",
        description = "Transparency of the background. 0% = fully transparent, 100% = fully opaque.",
        category = "Appearance",
        min = 0.0f,
        max = 1.0f,
        step = 1
    )
    var backgroundOpacity: Float = 0.25f
        set(value) {
            field = value
            Levelhead.displayManager.config.backgroundOpacity = value
            Levelhead.displayManager.saveConfig()
            save()
        }

    @Switch(
        name = "Text Shadow",
        description = "Render text with a shadow. Disable to match Patcher nametag settings.",
        category = "Appearance"
    )
    var textShadow: Boolean = false
        set(value) {
            field = value
            Levelhead.displayManager.config.textShadow = value
            Levelhead.displayManager.saveConfig()
            save()
        }

    // ===============================
    // Category: Performance (Optimization)
    // ===============================
    @Header(text = "Performance Tuning", category = "Performance")
    @Transient
    var performanceHeader: String = ""

    @Info(
        text = "Lower values improve accuracy but may impact FPS. Adjust if you experience lag.",
        type = InfoType.INFO,
        category = "Performance"
    )
    @Transient
    var performanceInfo: String = ""

    @Slider(
        name = "Render Distance",
        description = "Maximum distance (in blocks) to render levelheads. Lower = better performance.",
        category = "Performance",
        min = 16f,
        max = 128f,
        step = 8
    )
    var renderDistance: Int = 64
        set(value) {
            field = value
            Levelhead.displayManager.config.renderDistance = value
            Levelhead.displayManager.saveConfig()
            save()
        }

    @Slider(
        name = "Frame Skip",
        description = "Render every N frames. 1 = every frame (smooth), 2+ = skip frames (better FPS).",
        category = "Performance",
        min = 1f,
        max = 5f,
        step = 1
    )
    var frameSkip: Int = 1
        set(value) {
            field = value
            Levelhead.displayManager.config.frameSkip = value
            Levelhead.displayManager.saveConfig()
            save()
        }

    @Slider(
        name = "Render Throttle (ms)",
        description = "Minimum milliseconds between render updates. 0 = no throttling.",
        category = "Performance",
        min = 0f,
        max = 100f,
        step = 5
    )
    var renderThrottleMs: Int = 0
        set(value) {
            field = value
            Levelhead.displayManager.config.renderThrottleMs = value.toLong()
            Levelhead.displayManager.saveConfig()
            save()
        }

    @Slider(
        name = "Cache Size Limit",
        description = "Maximum number of cached player stats before automatic cleanup.",
        category = "Performance",
        min = 100f,
        max = 2000f,
        step = 100
    )
    var cacheSizeLimit: Int = 500
        set(value) {
            field = value
            Levelhead.displayManager.config.purgeSize = value
            Levelhead.displayManager.saveConfig()
            save()
        }

    @Slider(
        name = "Star Cache TTL (minutes)",
        description = "How long to cache player stars before refreshing. Higher values reduce API calls but may show outdated data.",
        category = "Performance",
        min = _MIN_STAR_CACHE_TTL_MINUTES_SLIDER,
        max = _MAX_STAR_CACHE_TTL_MINUTES_SLIDER,
        step = 1
    )
    var starCacheTtlMinutes: Int = _DEFAULT_STAR_CACHE_TTL_MINUTES
        set(value) {
            field = value.coerceIn(_MIN_STAR_CACHE_TTL_MINUTES, _MAX_STAR_CACHE_TTL_MINUTES)
            save()
            BedwarsFetcher.resetWarnings()
        }

    // ===============================
    // Category: Profiles (Presets)
    // ===============================
    @Header(text = "Configuration Profiles", category = "Profiles")
    @Transient
    var profilesHeader: String = ""

    @Info(
        text = "Apply a preset configuration or export/import your custom setup.",
        type = InfoType.INFO,
        category = "Profiles"
    )
    @Transient
    var profilesInfo: String = ""

    @Dropdown(
        name = "Preset",
        description = "Choose a preset configuration. Click 'Apply Preset' to load it.",
        category = "Profiles",
        options = ["Default", "Compact"]
    )
    var presetIndex: Int = 0

    @Button(
        name = "Apply Preset",
        text = "Load Preset",
        description = "Apply the selected preset configuration. This will overwrite your current settings!",
        category = "Profiles"
    )
    fun applyPresetButton() {
        val preset = when (presetIndex) {
            0 -> ConfigProfiles.Preset.DEFAULT
            1 -> ConfigProfiles.Preset.COMPACT
            else -> ConfigProfiles.Preset.DEFAULT
        }
        val profile = ConfigProfiles.getPreset(preset)
        ConfigProfiles.applyProfile(profile)
        Levelhead.sendChat("§aApplied preset: §b${preset.displayName}")
    }

    @Button(
        name = "Export Profile",
        text = "Copy to Clipboard",
        description = "Export your current configuration as JSON to the clipboard.",
        category = "Profiles"
    )
    fun exportProfileButton() {
        val profile = ConfigProfiles.exportProfile()
        try {
            val clipboard = java.awt.Toolkit.getDefaultToolkit().systemClipboard
            clipboard?.setContents(StringSelection(profile), null)
            Levelhead.sendChat("§aProfile exported to clipboard!")
        } catch (e: Exception) {
            Levelhead.logger.warn("Failed to copy profile to clipboard", e)
            Levelhead.sendChat("§cFailed to copy to clipboard. Use '/levelhead export' command instead.")
        }
    }

    @Text(
        name = "Import Profile JSON",
        placeholder = "Paste exported JSON here...",
        description = "Paste a previously exported profile JSON here, then click 'Import Profile'.",
        category = "Profiles"
    )
    var importProfileJson: String = ""

    @Button(
        name = "Import Profile",
        text = "Load from JSON",
        description = "Import the configuration from the JSON text above.",
        category = "Profiles"
    )
    fun importProfileButton() {
        if (importProfileJson.isBlank()) {
            Levelhead.sendChat("§cNo profile JSON provided. Paste JSON in the text field above first.")
            return
        }
        val profile = ConfigProfiles.importProfile(importProfileJson)
        if (profile != null) {
            ConfigProfiles.applyProfile(profile)
            Levelhead.sendChat("§aProfile imported successfully!")
            importProfileJson = ""
            save()
        } else {
            Levelhead.sendChat("§cFailed to import profile. Invalid JSON format.")
        }
    }

    // ===============================
    // Category: Quick Actions
    // ===============================
    @Header(text = "Quick Actions", category = "Actions")
    @Transient
    var actionsHeader: String = ""

    @Button(
        name = "Purge Cache",
        text = "Clear All Caches",
        description = "Clear all cached player stats. Fresh data will be fetched on next encounter.",
        category = "Actions"
    )
    fun purgeCacheButton() {
        Levelhead.displayManager.clearCache()
        Levelhead.sendChat("§aCache cleared! Fresh data will be fetched.")
    }

    @Button(
        name = "Reload Stats",
        text = "Refresh All",
        description = "Invalidate cached displays and re-fetch fresh data for all visible players.",
        category = "Actions"
    )
    fun reloadStatsButton() {
        Levelhead.displayManager.clearCache()
        Levelhead.sendChat("§aStats reloaded! Re-fetching fresh data.")
    }

    @Button(
        name = "Reset All Settings",
        text = "Reset to Defaults",
        description = "Restore all settings to their default values. This cannot be undone!",
        category = "Actions"
    )
    fun resetToDefaultsButton() {
        resetToDefaults()
        Levelhead.sendChat("§aAll settings reset to defaults.")
    }

    @Button(
        name = "Open Config Folder",
        text = "Open Folder",
        description = "Open the folder containing configuration files.",
        category = "Actions"
    )
    fun openConfigFolderButton() {
        try {
            val configDir = File(Minecraft.getMinecraft().mcDataDir, "config")
            if (Desktop.isDesktopSupported() && Desktop.getDesktop().isSupported(Desktop.Action.OPEN)) {
                Desktop.getDesktop().open(configDir)
            } else {
                Levelhead.sendChat("§eConfig folder: §b${configDir.absolutePath}")
            }
        } catch (e: Exception) {
            Levelhead.logger.warn("Failed to open config folder", e)
            Levelhead.sendChat("§cFailed to open config folder.")
        }
    }

    // ===============================
    // Category: Advanced (Hidden by default unless showAdvanced is enabled)
    // ===============================
    @Header(text = "Advanced Settings", category = "Advanced")
    @Transient
    var advancedHeader: String = ""

    @Info(
        text = "Warning: These settings are for advanced users. Incorrect configuration may cause issues.",
        type = InfoType.WARNING,
        category = "Advanced"
    )
    @Transient
    var advancedWarning: String = ""

    @Switch(
        name = "Show Advanced Options",
        description = "Enable to show additional advanced configuration options.",
        category = "Advanced"
    )
    var showAdvancedOptions: Boolean = false
        set(value) {
            field = value
            save()
            // This will trigger conditional visibility refresh
        }

    @Switch(
        name = "Use Proxy",
        description = "Route requests through the Levelhead backend. Required for Community API mode.",
        category = "Advanced"
    )
    var proxyEnabled: Boolean = true
        set(value) {
            field = value
            save()
            BedwarsFetcher.resetWarnings()
        }

    @Info(
        text = "Proxy URL is required when proxy is enabled.",
        type = InfoType.WARNING,
        category = "Advanced"
    )
    @Transient
    var proxyUrlWarning: String = ""

    @Text(
        name = "Proxy Base URL",
        placeholder = DEFAULT_PROXY_URL,
        description = "The backend base URL for proxy requests.",
        category = "Advanced"
    )
    var proxyBaseUrl: String = DEFAULT_PROXY_URL
        set(value) {
            field = value.trim()
            save()
            BedwarsFetcher.resetWarnings()
        }

    @Info(
        text = "Proxy Auth Token is recommended when using a private backend.",
        type = InfoType.INFO,
        category = "Advanced"
    )
    @Transient
    var proxyAuthInfo: String = ""

    @Text(
        name = "Proxy Auth Token",
        secure = true,
        description = "Authentication token for the proxy backend.",
        category = "Advanced"
    )
    var proxyAuthToken: String = ""
        set(value) {
            field = value.trim()
            save()
            BedwarsFetcher.resetWarnings()
        }

    @Switch(
        name = "Community Database",
        description = "Fetch stats from the community cache to save API requests. When you have an API key, your lookups will also contribute to the shared cache.",
        category = "Advanced"
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

    @Text(
        name = "Submission Secret",
        secure = true,
        description = "HMAC secret for signing community submissions. Must match the backend.",
        category = "Advanced"
    )
    var communitySubmitSecret: String = ""
        set(value) {
            field = value.trim()
            save()
        }

    @Text(
        name = "Custom Database URL",
        placeholder = "Leave blank to use default",
        description = "Override community database URL. Only works when using API key or self-hosting.",
        category = "Advanced"
    )
    var customDatabaseUrl: String = ""
        set(value) {
            field = value.trim()
            save()
            BedwarsFetcher.resetWarnings()
        }

    // ===============================
    // Category: About
    // ===============================
    @Header(text = "About BedWars Levelhead", category = "About")
    @Transient
    var aboutMainHeader: String = ""

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
    // Internal State
    // ===============================
    var welcomeMessageShown: Boolean = false
    var installId: String = ""

    val starCacheTtl: Duration
        get() = Duration.ofMinutes(starCacheTtlMinutes.coerceIn(_MIN_STAR_CACHE_TTL_MINUTES, _MAX_STAR_CACHE_TTL_MINUTES).toLong())

    /**
     * Get the current BackendMode based on the dropdown selection.
     */
    val backendMode: BackendMode
        get() = BackendMode.fromIndex(backendModeIndex)

    init {
        initialize()
        migrateLegacyConfig()
        ensureInstallId()
        setupConditionalVisibility()
    }

    private fun setupConditionalVisibility() {
        // Hide community database toggle when using shared backend - it's always enabled
        hideIf("communityDatabase") { isUsingSharedBackend() }
        
        // Hide advanced options unless showAdvancedOptions is enabled
        hideIf("proxyBaseUrl") { !showAdvancedOptions }
        hideIf("proxyAuthToken") { !showAdvancedOptions }
        hideIf("communitySubmitSecret") { !showAdvancedOptions }
        hideIf("customDatabaseUrl") { !showAdvancedOptions }
        hideIf("proxyUrlWarning") { !showAdvancedOptions || !proxyEnabled || proxyBaseUrl.isNotBlank() }
        hideIf("proxyAuthInfo") { !showAdvancedOptions }
        
        // Show API key warning only when in "Own API Key" mode and key is blank
        hideIf("apiKeyWarning") { 
            backendModeIndex != BACKEND_MODE_DIRECT_API || apiKey.isNotBlank() 
        }
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
        backendModeIndex = 2
        communityDatabase = true
        showTabStats = true
        proxyEnabled = true
        proxyBaseUrl = DEFAULT_PROXY_URL
        proxyAuthToken = ""
        communitySubmitSecret = ""
        customDatabaseUrl = ""
        starCacheTtlMinutes = DEFAULT_STAR_CACHE_TTL_MINUTES
        levelheadEnabled = true
        displayPositionIndex = 0
        showSelf = true
        fontSize = 1.0f
        verticalOffset = 0.0f
        showBackground = true
        backgroundOpacity = 0.25f
        textShadow = false
        renderDistance = 64
        frameSkip = 1
        renderThrottleMs = 0
        cacheSizeLimit = 500
        headerText = GameMode.BEDWARS.defaultHeader
        headerColorHex = "#55FFFF"
        footerFormat = "%star%"
        footerColorHex = "#FFFF55"
        showAdvancedOptions = false
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
