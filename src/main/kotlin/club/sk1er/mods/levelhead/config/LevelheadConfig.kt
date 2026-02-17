package club.sk1er.mods.levelhead.config

import club.sk1er.mods.levelhead.Levelhead
import club.sk1er.mods.levelhead.core.DnsMode
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
import com.google.gson.JsonObject
import com.google.gson.JsonParser
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
private const val OFFSET_EPSILON = 0.0001
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
        text = "Choose how stats are fetched. Fallback is recommended.",
        type = InfoType.INFO,
        category = "Quick Setup"
    )
    @Transient
    var backendModeInfo: String = ""

    @Dropdown(
        name = "Backend Mode",
        description = "Community API is fastest. Own API Key is most accurate. Fallback tries both.",
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
        text = "Own API Key mode requires a key from developer.hypixel.net",
        type = InfoType.WARNING,
        category = "Quick Setup"
    )
    @Transient
    var apiKeyWarning: String = ""


    @Text(
        name = "Hypixel API Key", 
        placeholder = "Paste your API key here (get one from developer.hypixel.net)", 
        secure = true,
        description = "Required for Own API Key mode and community submissions.",
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
            if (field == value) {
                return
            }
            field = value
            if (syncingFromRuntime) {
                save()
                return
            }
            applyEnabledToRuntime(value)
            save()
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
            if (field == clamped) {
                return
            }
            field = clamped
            if (syncingFromRuntime) {
                save()
                return
            }
            val displayPosition = entries.getOrNull(clamped) ?: MasterConfig.DisplayPosition.ABOVE
            applyDisplayPositionToRuntime(displayPosition)
        }

    @Switch(
        name = "Show Self",
        description = "Display your own levelhead above your head.",
        category = "Display"
    )
    var showSelf: Boolean = true
        set(value) {
            if (field == value) {
                return
            }
            field = value
            if (syncingFromRuntime) {
                save()
                return
            }
            applyShowSelfToRuntime(value)
            save()
        }

    @Switch(
        name = "Show In Inventory",
        description = "Render your levelhead while your inventory screen is open.",
        category = "Display"
    )
    var showInInventory: Boolean = true

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
            Levelhead.displayManager.applyPrimaryDisplayConfigToCache()
            Levelhead.displayManager.refreshVisibleDisplays()
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
                Levelhead.displayManager.applyPrimaryDisplayConfigToCache()
                Levelhead.displayManager.refreshVisibleDisplays()
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
        description = "Legacy global footer format. Sets all mode templates to custom.",
        category = "Display"
    )
    var footerFormat: String = "%star%"
        set(value) {
            field = value
            val template = value.ifBlank { "%star%" }
            bedwarsStatDisplayIndex = BedwarsStatMode.CUSTOM.ordinal
            duelsStatDisplayIndex = DuelsStatMode.CUSTOM.ordinal
            skywarsStatDisplayIndex = SkyWarsStatMode.CUSTOM.ordinal
            bedwarsCustomFooterFormat = template
            duelsCustomFooterFormat = template
            skywarsCustomFooterFormat = template
            Levelhead.displayManager.updatePrimaryDisplay { config ->
                config.footerString = template
                true
            }
            refreshDisplayStats(clearStats = false)
            save()
        }

    @Header(text = "Mode Stat Display", category = "Display")
    @Transient
    var modeStatHeader: String = ""

    @Dropdown(
        name = "BedWars Footer",
        description = "Choose what BedWars shows in the footer.",
        category = "Display",
        options = ["Star", "FKDR", "Winstreak", "Custom"]
    )
    var bedwarsStatDisplayIndex: Int = BedwarsStatMode.STAR.ordinal
        set(value) {
            val oldMode = BedwarsStatMode.entries[field]
            val newMode = BedwarsStatMode.entries[value.coerceIn(0, BedwarsStatMode.entries.lastIndex)]
            field = value.coerceIn(0, BedwarsStatMode.entries.lastIndex)

            // Update header text if it's using the default for the old mode
            if (newMode != BedwarsStatMode.CUSTOM) {
                val oldDefaultHeader = getBedwarsHeaderForMode(oldMode)
                val newDefaultHeader = getBedwarsHeaderForMode(newMode)
                if (headerText.equals(oldDefaultHeader, ignoreCase = true)) {
                    headerText = newDefaultHeader
                }
            }

            refreshDisplayStats(clearStats = true)
            save()
        }

    @Text(
        name = "BedWars Custom Format",
        placeholder = "%star%",
        description = "Used when BedWars Footer is set to Custom. Tokens: %star%, %fkdr%, %ws%.",
        category = "Display"
    )
    var bedwarsCustomFooterFormat: String = "%star%"
        set(value) {
            field = value.ifBlank { "%star%" }
            refreshDisplayStats(clearStats = false)
            save()
        }

    @Dropdown(
        name = "Duels Footer",
        description = "Choose what Duels shows in the footer.",
        category = "Display",
        options = ["Division Title", "Wins", "WLR", "KDR", "Winstreak", "Division Symbol", "Custom"]
    )
    var duelsStatDisplayIndex: Int = DuelsStatMode.DIVISION_TITLE.ordinal
        set(value) {
            field = value.coerceIn(0, DuelsStatMode.entries.lastIndex)
            refreshDisplayStats(clearStats = true)
            save()
        }

    @Text(
        name = "Duels Custom Format",
        placeholder = "%division%",
        description = "Used when Duels Footer is set to Custom. Tokens: %division%, %divsymbol%, %divlevel%, %wins%, %losses%, %wlr%, %kdr%, %ws%.",
        category = "Display"
    )
    var duelsCustomFooterFormat: String = "%division%"
        set(value) {
            field = value.ifBlank { "%division%" }
            refreshDisplayStats(clearStats = false)
            save()
        }

    @Dropdown(
        name = "SkyWars Footer",
        description = "Choose what SkyWars shows in the footer.",
        category = "Display",
        options = ["Star", "Wins", "WLR", "KDR", "Custom"]
    )
    var skywarsStatDisplayIndex: Int = SkyWarsStatMode.STAR.ordinal
        set(value) {
            field = value.coerceIn(0, SkyWarsStatMode.entries.lastIndex)
            refreshDisplayStats(clearStats = true)
            save()
        }

    @Text(
        name = "SkyWars Custom Format",
        placeholder = "%star%",
        description = "Used when SkyWars Footer is set to Custom. Tokens: %star%, %level%, %wins%, %losses%, %wlr%, %kdr%.",
        category = "Display"
    )
    var skywarsCustomFooterFormat: String = "%star%"
        set(value) {
            field = value.ifBlank { "%star%" }
            refreshDisplayStats(clearStats = false)
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
                Levelhead.displayManager.applyPrimaryDisplayConfigToCache()
                Levelhead.displayManager.refreshVisibleDisplays()
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
        name = "Vertical Offset",
        description = "Fine-tune the vertical position. Negative values move it closer to the nametag.",
        category = "Appearance",
        min = -0.5f,
        max = 0.5f,
    )
    var verticalOffset: Float = 0.0f
        set(value) {
            if (kotlin.math.abs(field - value) < OFFSET_EPSILON) {
                return
            }
            field = value
            if (syncingFromRuntime) {
                save()
                return
            }
            applyOffsetToRuntime(value.toDouble())
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
        text = "Lower values improve accuracy but may reduce FPS.",
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
        description = "How long to cache stars before refresh.",
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
        text = "Apply presets or export/import your setup.",
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
        description = "Apply selected preset (overwrites current settings).",
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
        text = "Advanced options. Incorrect values can cause issues.",
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
        name = "Debug Config Sync",
        description = "Log OneConfig/runtime sync decisions to latest.log for troubleshooting UI toggles.",
        category = "Advanced"
    )
    var debugConfigSync: Boolean = false
        set(value) {
            field = value
            save()
        }

    @Switch(
        name = "Debug Requests",
        description = "Log HTTP requests and responses to latest.log for troubleshooting API calls.",
        category = "Advanced"
    )
    var debugRequests: Boolean = false
        set(value) {
            field = value
            save()
        }

    @Switch(
        name = "Debug Render Sampling",
        description = "Log header/footer text above nametags to latest.log for troubleshooting. Use /levelhead debugrender [on|off] to toggle in-game.",
        category = "Advanced"
    )
    var debugRenderSampling: Boolean = false
        set(value) {
            field = value
            save()
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
    @Dropdown(
        name = "DNS Resolution Mode",
        description = "Choose how to resolve domain names. IPv4 First is recommended for most users.",
        category = "Advanced",
        options = ["IPv4 Only", "IPv4 First", "System Default"]
    )
    var dnsModeIndex: Int = 1 // Default to IPv4 First
        set(value) {
            field = value.coerceIn(0, DnsMode.entries.size - 1)
            save()
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
        description = "Use shared community cache. API keys can also submit new data.",
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
        description = "Override database URL (API key or self-hosted setups).",
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
        text = "Built on the original Levelhead by Sk1er LLC.",
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
        text = "Licensed under GNU GPL v3.",
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
        description = "Download the latest version from Modrinth.",
        category = "About"
    )
    fun openModrinth() = openUrl(MODRINTH_URL)

    @Button(
        name = "Source Code",
        text = "View on GitHub",
        description = "View source code and contribute on GitHub.",
        category = "About"
    )
    fun openSource() = openUrl(GITHUB_REPO_URL)

    @Button(
        name = "Original Levelhead",
        text = "Meet the Original",
        description = "Visit the original Levelhead project.",
        category = "About"
    )
    fun openUpstream() = openUrl(UPSTREAM_LEVELHEAD_URL)

    @Button(
        name = "Changelog",
        text = "What's New?",
        description = "View recent releases and changes.",
        category = "About"
    )
    fun openChangelog() = openUrl(CHANGELOG_URL)

    @Button(
        name = "Documentation",
        text = "How to Use",
        description = "Open setup docs and usage guide.",
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
    val dnsMode: DnsMode
        get() = DnsMode.fromIndex(dnsModeIndex)

    val backendMode: BackendMode
        get() = BackendMode.fromIndex(backendModeIndex)

    @Transient
    private var syncingFromRuntime: Boolean = false

    @Transient
    private var lastSyncSnapshot: ConfigSyncSnapshot? = null

    @Transient
    private var configSyncTickCounter: Int = 0

    @Transient
    @Volatile
    private var syncRequested: Boolean = false

    data class ConfigSyncSnapshot(
        val uiEnabled: Boolean,
        val rtEnabled: Boolean,
        val uiShowSelf: Boolean,
        val rtShowSelf: Boolean,
        val uiDisplayPosition: MasterConfig.DisplayPosition,
        val rtDisplayPosition: MasterConfig.DisplayPosition,
        val uiOffset: Double,
        val rtOffset: Double
    )

    private interface StatMode {
        val template: String
    }

    enum class BedwarsStatMode(override val template: String) : StatMode {
        STAR("%star%"),
        FKDR("%fkdr%"),
        WINSTREAK("%ws%"),
        CUSTOM("")
    }

    enum class DuelsStatMode(override val template: String) : StatMode {
        DIVISION_TITLE("%division%"),
        WINS("%wins%"),
        WLR("%wlr%"),
        KDR("%kdr%"),
        WINSTREAK("%ws%"),
        DIVISION_SYMBOL("%divsymbol%"),
        CUSTOM("")
    }

    enum class SkyWarsStatMode(override val template: String) : StatMode {
        STAR("%star%"),
        WINS("%wins%"),
        WLR("%wlr%"),
        KDR("%kdr%"),
        CUSTOM("")
    }

    private val bedwarsStatMode: BedwarsStatMode
        get() = BedwarsStatMode.entries.getOrNull(bedwarsStatDisplayIndex) ?: BedwarsStatMode.STAR

    private val duelsStatMode: DuelsStatMode
        get() = DuelsStatMode.entries.getOrNull(duelsStatDisplayIndex) ?: DuelsStatMode.DIVISION_TITLE

    private val skywarsStatMode: SkyWarsStatMode
        get() = SkyWarsStatMode.entries.getOrNull(skywarsStatDisplayIndex) ?: SkyWarsStatMode.STAR

    private fun getBedwarsHeaderForMode(mode: BedwarsStatMode): String {
        return when (mode) {
            BedwarsStatMode.STAR -> "BedWars Star"
            BedwarsStatMode.FKDR -> "BedWars FKDR"
            BedwarsStatMode.WINSTREAK -> "BedWars Winstreak"
            BedwarsStatMode.CUSTOM -> headerText
        }
    }

    private fun <T> resolveTemplateFor(
        modeIndex: Int,
        entries: List<T>,
        defaultMode: T,
        customFormat: String,
        customMode: T,
        defaultCustomTemplate: String
    ): String where T : Enum<*>, T : StatMode {
        val mode = entries.getOrNull(modeIndex) ?: defaultMode
        return if (mode == customMode) {
            customFormat.ifBlank { defaultCustomTemplate }
        } else {
            mode.template
        }
    }

    fun footerTemplateFor(gameMode: GameMode, config: DisplayConfig): String {
        val template = when (gameMode) {
            GameMode.BEDWARS -> resolveTemplateFor(
                bedwarsStatDisplayIndex,
                BedwarsStatMode.entries,
                BedwarsStatMode.STAR,
                bedwarsCustomFooterFormat,
                BedwarsStatMode.CUSTOM,
                "%star%"
            )
            GameMode.DUELS -> resolveTemplateFor(
                duelsStatDisplayIndex,
                DuelsStatMode.entries,
                DuelsStatMode.DIVISION_TITLE,
                duelsCustomFooterFormat,
                DuelsStatMode.CUSTOM,
                "%division%"
            )
            GameMode.SKYWARS -> resolveTemplateFor(
                skywarsStatDisplayIndex,
                SkyWarsStatMode.entries,
                SkyWarsStatMode.STAR,
                skywarsCustomFooterFormat,
                SkyWarsStatMode.CUSTOM,
                "%star%"
            )
        }
        return template.ifBlank {
            config.footerString?.takeIf { it.isNotBlank() } ?: gameMode.statFormat
        }
    }

    init {
        initialize()
        migrateLegacyConfig()
        ensureInstallId()
        setupConditionalVisibility()
        syncUiStateFromRuntime(initialSync = true)
    }

    fun syncUiAndRuntimeConfig() {
        val mc = Minecraft.getMinecraft()
        val isGuiOpen = mc.currentScreen != null

        configSyncTickCounter++
        val interval = if (isGuiOpen || syncRequested) 5 else 100

        if (configSyncTickCounter % interval != 0 && !syncRequested) {
            return
        }

        syncRequested = false

        val primaryDisplay = Levelhead.displayManager.primaryDisplay() ?: return
        val runtimeEnabled = Levelhead.displayManager.config.enabled
        val runtimeShowSelf = primaryDisplay.config.showSelf
        val runtimeDisplayPosition = Levelhead.displayManager.config.displayPosition
        val runtimeOffset = Levelhead.displayManager.config.offset

        val entries = MasterConfig.DisplayPosition.entries
        val uiDisplayPosition = entries.getOrNull(displayPositionIndex) ?: MasterConfig.DisplayPosition.ABOVE
        val uiOffset = verticalOffset.toDouble()

        val snapshot = lastSyncSnapshot

        syncSingleSetting(
            name = "enabled",
            uiValue = levelheadEnabled,
            runtimeValue = runtimeEnabled,
            snapshotUi = snapshot?.uiEnabled,
            snapshotRuntime = snapshot?.rtEnabled,
            applyUiToRuntime = { value -> applyEnabledToRuntime(value) },
            applyRuntimeToUi = { value ->
                syncingFromRuntime = true
                try {
                    levelheadEnabled = value
                } finally {
                    syncingFromRuntime = false
                }
            }
        )

        syncSingleSetting(
            name = "showSelf",
            uiValue = showSelf,
            runtimeValue = runtimeShowSelf,
            snapshotUi = snapshot?.uiShowSelf,
            snapshotRuntime = snapshot?.rtShowSelf,
            applyUiToRuntime = { value -> applyShowSelfToRuntime(value) },
            applyRuntimeToUi = { value ->
                syncingFromRuntime = true
                try {
                    showSelf = value
                } finally {
                    syncingFromRuntime = false
                }
            }
        )

        syncSingleSetting(
            name = "displayPosition",
            uiValue = uiDisplayPosition,
            runtimeValue = runtimeDisplayPosition,
            snapshotUi = snapshot?.uiDisplayPosition,
            snapshotRuntime = snapshot?.rtDisplayPosition,
            applyUiToRuntime = { value -> applyDisplayPositionToRuntime(value) },
            applyRuntimeToUi = { value ->
                val idx = entries.indexOf(value).takeIf { it >= 0 } ?: 0
                syncingFromRuntime = true
                try {
                    displayPositionIndex = idx
                } finally {
                    syncingFromRuntime = false
                }
            }
        )

        syncSingleSetting(
            name = "offset",
            uiValue = uiOffset,
            runtimeValue = runtimeOffset,
            snapshotUi = snapshot?.uiOffset,
            snapshotRuntime = snapshot?.rtOffset,
            equals = { left, right -> kotlin.math.abs(left - right) < OFFSET_EPSILON },
            applyUiToRuntime = { value -> applyOffsetToRuntime(value) },
            applyRuntimeToUi = { value ->
                syncingFromRuntime = true
                try {
                    verticalOffset = value.toFloat()
                } finally {
                    syncingFromRuntime = false
                }
            }
        )

        val finalDisplayPosition = entries.getOrNull(displayPositionIndex) ?: MasterConfig.DisplayPosition.ABOVE
        val finalPrimaryDisplay = Levelhead.displayManager.primaryDisplay() ?: return
        lastSyncSnapshot = ConfigSyncSnapshot(
            uiEnabled = levelheadEnabled,
            rtEnabled = Levelhead.displayManager.config.enabled,
            uiShowSelf = showSelf,
            rtShowSelf = finalPrimaryDisplay.config.showSelf,
            uiDisplayPosition = finalDisplayPosition,
            rtDisplayPosition = Levelhead.displayManager.config.displayPosition,
            uiOffset = verticalOffset.toDouble(),
            rtOffset = Levelhead.displayManager.config.offset
        )
    }

    private fun syncUiStateFromRuntime(initialSync: Boolean) {
        val primaryDisplay = Levelhead.displayManager.primaryDisplay() ?: return
        val entries = MasterConfig.DisplayPosition.entries
        val runtimeDisplayPosition = Levelhead.displayManager.config.displayPosition
        val displayIndex = entries.indexOf(runtimeDisplayPosition).takeIf { it >= 0 } ?: 0

        syncingFromRuntime = true
        try {
            levelheadEnabled = Levelhead.displayManager.config.enabled
            showSelf = primaryDisplay.config.showSelf
            displayPositionIndex = displayIndex
            verticalOffset = Levelhead.displayManager.config.offset.toFloat()
        } finally {
            syncingFromRuntime = false
        }

        lastSyncSnapshot = ConfigSyncSnapshot(
            uiEnabled = levelheadEnabled,
            rtEnabled = Levelhead.displayManager.config.enabled,
            uiShowSelf = showSelf,
            rtShowSelf = primaryDisplay.config.showSelf,
            uiDisplayPosition = entries.getOrNull(displayPositionIndex) ?: MasterConfig.DisplayPosition.ABOVE,
            rtDisplayPosition = runtimeDisplayPosition,
            uiOffset = verticalOffset.toDouble(),
            rtOffset = Levelhead.displayManager.config.offset
        )

        if (debugConfigSync) {
            val source = if (initialSync) "initial" else "runtime"
            Levelhead.logger.info(
                "[LevelheadConfigSync] RT->UI {} sync enabled={}, showSelf={}, displayPosition={}, offset={}",
                source,
                levelheadEnabled,
                showSelf,
                runtimeDisplayPosition,
                String.format(Locale.ROOT, "%.2f", Levelhead.displayManager.config.offset)
            )
        }
    }

    private fun applyEnabledToRuntime(value: Boolean) {
        if (Levelhead.displayManager.config.enabled != value) {
            Levelhead.displayManager.setEnabled(value)
        }
        if (debugConfigSync) {
            Levelhead.logger.info("[LevelheadConfigSync] UI->RT enabled={}", value)
        }
    }

    private fun applyShowSelfToRuntime(value: Boolean) {
        Levelhead.displayManager.updatePrimaryDisplay { config ->
            if (config.showSelf == value) {
                return@updatePrimaryDisplay false
            }
            config.showSelf = value
            true
        }
        if (debugConfigSync) {
            Levelhead.logger.info("[LevelheadConfigSync] UI->RT showSelf={}", value)
        }
    }

    private fun applyDisplayPositionToRuntime(value: MasterConfig.DisplayPosition) {
        if (Levelhead.displayManager.config.displayPosition != value) {
            Levelhead.displayManager.config.displayPosition = value
            Levelhead.displayManager.saveConfig()
        }
        if (debugConfigSync) {
            Levelhead.logger.info("[LevelheadConfigSync] UI->RT displayPosition={}", value)
        }
    }

    private fun applyOffsetToRuntime(value: Double) {
        if (kotlin.math.abs(Levelhead.displayManager.config.offset - value) >= OFFSET_EPSILON) {
            Levelhead.displayManager.config.offset = value
            Levelhead.displayManager.saveConfig()
        }
        if (debugConfigSync) {
            Levelhead.logger.info("[LevelheadConfigSync] UI->RT offset={}", String.format(Locale.ROOT, "%.2f", value))
        }
    }

    private fun <T> syncSingleSetting(
        name: String,
        uiValue: T,
        runtimeValue: T,
        snapshotUi: T?,
        snapshotRuntime: T?,
        equals: (T, T) -> Boolean = { left, right -> left == right },
        applyUiToRuntime: (T) -> Unit,
        applyRuntimeToUi: (T) -> Unit
    ) {
        if (equals(uiValue, runtimeValue)) {
            return
        }

        val uiChanged = snapshotUi?.let { !equals(uiValue, it) } ?: false
        val runtimeChanged = snapshotRuntime?.let { !equals(runtimeValue, it) } ?: false

        val direction = when {
            uiChanged && !runtimeChanged -> "UI->RT"
            runtimeChanged && !uiChanged -> "RT->UI"
            uiChanged && runtimeChanged -> "UI->RT (conflict)"
            else -> "UI->RT (bootstrap)"
        }

        if (direction.startsWith("RT->UI")) {
            applyRuntimeToUi(runtimeValue)
        } else {
            applyUiToRuntime(uiValue)
        }

        if (debugConfigSync) {
            Levelhead.logger.info("[LevelheadConfigSync] {} {} ui={} runtime={}", direction, name, uiValue, runtimeValue)
        }
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
        hideIf("dnsModeIndex") { !showAdvancedOptions }

        hideIf("bedwarsCustomFooterFormat") {
            bedwarsStatMode != BedwarsStatMode.CUSTOM
        }
        hideIf("duelsCustomFooterFormat") {
            duelsStatMode != DuelsStatMode.CUSTOM
        }
        hideIf("skywarsCustomFooterFormat") {
            skywarsStatMode != SkyWarsStatMode.CUSTOM
        }
        
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
            val json = JsonParser.parseString(jsonContent)
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

    fun requestSync() {
        syncRequested = true
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
        dnsModeIndex = 1
        proxyAuthToken = ""
        communitySubmitSecret = ""
        customDatabaseUrl = ""
        starCacheTtlMinutes = DEFAULT_STAR_CACHE_TTL_MINUTES
        levelheadEnabled = true
        displayPositionIndex = 0
        showSelf = true
        showInInventory = true
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
        bedwarsStatDisplayIndex = BedwarsStatMode.STAR.ordinal
        duelsStatDisplayIndex = DuelsStatMode.DIVISION_TITLE.ordinal
        skywarsStatDisplayIndex = SkyWarsStatMode.STAR.ordinal
        bedwarsCustomFooterFormat = "%star%"
        duelsCustomFooterFormat = "%division%"
        skywarsCustomFooterFormat = "%star%"
        footerColorHex = "#FFFF55"
        showAdvancedOptions = false
        debugConfigSync = false
        debugRequests = false
        debugRenderSampling = false
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

    private fun refreshDisplayStats(clearStats: Boolean) {
        Levelhead.displayManager.clearCachesWithoutRefetch(clearStats = clearStats)
        Levelhead.displayManager.refreshVisibleDisplays()
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
