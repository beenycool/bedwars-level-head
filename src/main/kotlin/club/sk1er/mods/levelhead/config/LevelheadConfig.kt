package club.sk1er.mods.levelhead.config

import club.sk1er.mods.levelhead.Levelhead
import club.sk1er.mods.levelhead.bedwars.BedwarsFetcher
import club.sk1er.mods.levelhead.core.GameMode
import club.sk1er.mods.levelhead.core.TagFormatter
import cc.polyfrost.oneconfig.config.Config
import cc.polyfrost.oneconfig.config.annotations.Button
import cc.polyfrost.oneconfig.config.annotations.Color
import cc.polyfrost.oneconfig.config.annotations.Dropdown
import cc.polyfrost.oneconfig.config.annotations.Header
import cc.polyfrost.oneconfig.config.annotations.Info
import cc.polyfrost.oneconfig.config.annotations.Slider
import cc.polyfrost.oneconfig.config.annotations.Switch
import cc.polyfrost.oneconfig.config.annotations.Text
import cc.polyfrost.oneconfig.config.core.OneColor
import cc.polyfrost.oneconfig.config.data.InfoType
import cc.polyfrost.oneconfig.config.data.Mod
import cc.polyfrost.oneconfig.config.data.ModType
import net.minecraft.client.Minecraft
import java.awt.Desktop
import java.io.File
import java.net.URI
import java.time.Duration
import java.util.Locale
import java.util.UUID

private const val DEFAULT_PROXY_URL = "https://bedwars-level-head.onrender.com/"
private const val _MIN_STAR_CACHE_TTL_MINUTES = 5
private const val _MAX_STAR_CACHE_TTL_MINUTES = 180
private const val _DEFAULT_STAR_CACHE_TTL_MINUTES = 45
private const val GITHUB_REPO_URL = "https://github.com/beenycool/bedwars-level-head"
private const val UPSTREAM_LEVELHEAD_URL = "https://github.com/Sk1erLLC/Levelhead"
private const val MODRINTH_URL = "https://modrinth.com/mod/bedwars-level-head"
private const val WIKI_URL = "https://github.com/beenycool/bedwars-level-head/wiki"
private const val CHANGELOG_URL = "https://github.com/beenycool/bedwars-level-head/releases"

/**
 * The only settings store. OneConfig persists these fields and every runtime
 * component reads them directly (through the small [MasterConfig] / [DisplayConfig]
 * views), so there is no second file to drift out of sync.
 */
object LevelheadConfig : Config(Mod("BedWars Levelhead", ModType.HYPIXEL), "bedwars-levelhead.json") {

    // ===============================
    // Category: Quick Setup
    // ===============================
    @Header(text = "Quick Setup", category = "Quick Setup")
    @Transient
    var quickSetupHeader: String = ""

    @Switch(
        name = "Show Tab Stats",
        description = "Display stats next to player names in the Tab list.",
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

        Levelhead.sendChat("§b§lBedWars Levelhead Status")
        Levelhead.sendChat(" §7- §bBackend: §e${proxyBaseUrl.ifBlank { DEFAULT_PROXY_URL }}")
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
    // Category: Display
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
            field = value.coerceIn(0, MasterConfig.DisplayPosition.entries.lastIndex)
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
            save()
        }

    @Header(text = "Header Text (per game mode)", category = "Display")
    @Transient
    var headerTextHeader: String = ""

    @Text(
        name = "BedWars Header",
        placeholder = "BedWars Star",
        description = "The text shown before the BedWars stat.",
        category = "Display"
    )
    var bedwarsHeaderText: String = GameMode.BEDWARS.defaultHeader
        set(value) {
            field = value
            save()
        }

    @Text(
        name = "Duels Header",
        placeholder = "Duels Division",
        description = "The text shown before the Duels stat.",
        category = "Display"
    )
    var duelsHeaderText: String = GameMode.DUELS.defaultHeader
        set(value) {
            field = value
            save()
        }

    @Text(
        name = "SkyWars Header",
        placeholder = "SkyWars Star",
        description = "The text shown before the SkyWars stat.",
        category = "Display"
    )
    var skywarsHeaderText: String = GameMode.SKYWARS.defaultHeader
        set(value) {
            field = value
            save()
        }

    @Color(name = "Header Color", description = "Color for the header text.", category = "Display")
    var headerColor: OneColor = OneColor(85, 255, 255)
        set(value) {
            field = value
            save()
        }

    @Header(text = "Footer (Stat) Text", category = "Display")
    @Transient
    var footerTextHeader: String = ""

    @Dropdown(
        name = "BedWars Footer",
        description = "Choose what BedWars shows in the footer.",
        category = "Display",
        options = ["Star", "FKDR", "Custom"]
    )
    var bedwarsStatDisplayIndex: Int = BedwarsStatMode.STAR.ordinal
        set(value) {
            field = value.coerceIn(0, BedwarsStatMode.entries.lastIndex)
            save()
        }

    @Text(
        name = "BedWars Custom Format",
        placeholder = "%star%",
        description = "Used when BedWars Footer is set to Custom. Tokens: %star%, %fkdr%.",
        category = "Display"
    )
    var bedwarsCustomFooterFormat: String = "%star%"
        set(value) {
            field = value.ifBlank { "%star%" }
            save()
        }

    @Dropdown(
        name = "Duels Footer",
        description = "Choose what Duels shows in the footer.",
        category = "Display",
        options = ["Division Title", "Wins", "WLR", "Custom"]
    )
    var duelsStatDisplayIndex: Int = DuelsStatMode.DIVISION_TITLE.ordinal
        set(value) {
            field = value.coerceIn(0, DuelsStatMode.entries.lastIndex)
            save()
        }

    @Text(
        name = "Duels Custom Format",
        placeholder = "%division%",
        description = "Used when Duels Footer is set to Custom. Tokens: %division%, %divlevel%, %wins%, %losses%, %wlr%.",
        category = "Display"
    )
    var duelsCustomFooterFormat: String = "%division%"
        set(value) {
            field = value.ifBlank { "%division%" }
            save()
        }

    @Dropdown(
        name = "SkyWars Footer",
        description = "Choose what SkyWars shows in the footer.",
        category = "Display",
        options = ["Star", "Wins", "WLR", "Custom"]
    )
    var skywarsStatDisplayIndex: Int = SkyWarsStatMode.STAR.ordinal
        set(value) {
            field = value.coerceIn(0, SkyWarsStatMode.entries.lastIndex)
            save()
        }

    @Text(
        name = "SkyWars Custom Format",
        placeholder = "%star%",
        description = "Used when SkyWars Footer is set to Custom. Tokens: %star%, %level%, %wins%, %losses%, %wlr%.",
        category = "Display"
    )
    var skywarsCustomFooterFormat: String = "%star%"
        set(value) {
            field = value.ifBlank { "%star%" }
            save()
        }

    @Color(name = "Footer Color", description = "Color for the footer text.", category = "Display")
    var footerColor: OneColor = OneColor(255, 255, 85)
        set(value) {
            field = value
            save()
        }

    // ===============================
    // Tab List Display
    // ===============================
    @Header(text = "Tab List Display", category = "Display")
    @Transient
    var tabListDisplayHeader: String = ""

    @Switch(
        name = "Tab Show Self",
        description = "Display your own stats in the tab list.",
        category = "Display"
    )
    var tabShowSelf: Boolean = true
        set(value) {
            field = value
            save()
        }

    @Color(name = "Tab Footer Color", description = "Color for stats text in the tab list.", category = "Display")
    var tabFooterColor: OneColor = OneColor(255, 255, 85)
        set(value) {
            field = value
            save()
        }

    @Text(
        name = "Tab Footer Format",
        placeholder = "%star% : %fkdr%",
        description = "Custom format for tab list stats. Tokens: %star%, %fkdr%, %wins%, %losses%, %wlr%, %kdr%.",
        category = "Display"
    )
    var tabFooterFormat: String = ""
        set(value) {
            field = value
            save()
        }

    // ===============================
    // Category: Appearance
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
            field = value
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
            save()
        }

    @Slider(
        name = "Background Opacity",
        description = "Transparency of the background. 0% = fully transparent, 100% = fully opaque.",
        category = "Appearance",
        min = 0.0f,
        max = 1.0f
    )
    var backgroundOpacity: Float = 0.25f
        set(value) {
            field = value
            save()
        }

    @Switch(
        name = "Text Shadow",
        description = "Render text with a shadow. Disable to match Patcher nametag settings.",
        category = "Appearance"
    )
    var textShadow: Boolean = true
        set(value) {
            field = value
            save()
        }

    // ===============================
    // Category: Performance
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
            save()
        }

    @Slider(
        name = "Star Cache TTL (minutes)",
        description = "How long to cache stars before refresh.",
        category = "Performance",
        min = 5f,
        max = 180f,
        step = 1
    )
    var starCacheTtlMinutes: Int = _DEFAULT_STAR_CACHE_TTL_MINUTES
        set(value) {
            field = value.coerceIn(_MIN_STAR_CACHE_TTL_MINUTES, _MAX_STAR_CACHE_TTL_MINUTES)
            save()
            BedwarsFetcher.resetWarnings()
        }

    // ===============================
    // Category: Actions
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
    // Category: Advanced
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
        }

    @Switch(
        name = "Debug Logging",
        description = "Log HTTP requests and responses to latest.log for troubleshooting.",
        category = "Advanced"
    )
    var debugRequests: Boolean = false
        set(value) {
            field = value
            save()
        }

    @Info(
        text = "The backend URL is only needed for a self-hosted instance.",
        type = InfoType.INFO,
        category = "Advanced"
    )
    @Transient
    var backendUrlInfo: String = ""

    @Text(
        name = "Backend URL",
        placeholder = DEFAULT_PROXY_URL,
        description = "The backend base URL used for stat requests.",
        category = "Advanced"
    )
    var proxyBaseUrl: String = DEFAULT_PROXY_URL
        set(value) {
            field = value.trim()
            save()
            BedwarsFetcher.resetWarnings()
        }

    @Switch(
        name = "Force On All Servers",
        description = "Enable Levelhead on all servers, not just Hypixel. Useful when using proxy services that change your server IP.",
        category = "Advanced"
    )
    var forceEnabled: Boolean = false
        set(value) {
            field = value
            save()
        }

    // ===============================
    // Category: About
    // ===============================
    @Header(text = "About BedWars Levelhead", category = "About")
    @Transient
    var aboutMainHeader: String = ""

    @Info(
        text = "BedWars Levelhead shows player stats above their heads on Hypixel.",
        type = InfoType.INFO,
        category = "About"
    )
    @Transient
    var aboutDescription: String = ""

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
    // Internal state
    // ===============================
    var installId: String = ""

    val starCacheTtl: Duration
        get() = Duration.ofMinutes(
            starCacheTtlMinutes.coerceIn(_MIN_STAR_CACHE_TTL_MINUTES, _MAX_STAR_CACHE_TTL_MINUTES).toLong()
        )

    private interface StatMode {
        val template: String
    }

    enum class BedwarsStatMode(override val template: String) : StatMode {
        STAR("%star%"),
        FKDR("%fkdr%"),
        CUSTOM("");
    }

    /**
     * The last entry is kept for [club.sk1er.mods.levelhead.core.StatsFormatter]'s
     * division-color decision but is not reachable from the footer dropdown.
     */
    enum class DuelsStatMode(override val template: String) : StatMode {
        DIVISION_TITLE("%division%"),
        WINS("%wins%"),
        WLR("%wlr%"),
        CUSTOM(""),
        DIVISION_SYMBOL("%divsymbol%");
    }

    enum class SkyWarsStatMode(override val template: String) : StatMode {
        STAR("%star%"),
        WINS("%wins%"),
        WLR("%wlr%"),
        CUSTOM("");
    }

    private val bedwarsStatMode: BedwarsStatMode
        get() = BedwarsStatMode.entries.getOrNull(bedwarsStatDisplayIndex) ?: BedwarsStatMode.STAR

    private val duelsStatMode: DuelsStatMode
        get() = DuelsStatMode.entries.getOrNull(duelsStatDisplayIndex) ?: DuelsStatMode.DIVISION_TITLE

    private val skywarsStatMode: SkyWarsStatMode
        get() = SkyWarsStatMode.entries.getOrNull(skywarsStatDisplayIndex) ?: SkyWarsStatMode.STAR

    /**
     * The header is a per-mode concept: changing the BedWars footer must never
     * rewrite the Duels or SkyWars header (B36).
     */
    fun headerTextFor(gameMode: GameMode): String = when (gameMode) {
        GameMode.BEDWARS -> bedwarsHeaderText.ifBlank { GameMode.BEDWARS.defaultHeader }
        GameMode.DUELS -> duelsHeaderText.ifBlank { GameMode.DUELS.defaultHeader }
        GameMode.SKYWARS -> skywarsHeaderText.ifBlank { GameMode.SKYWARS.defaultHeader }
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

    /**
     * Resolve the footer template for a game mode.
     *
     * @param preferDisplayFooter when true, a non-blank
     *   [DisplayConfig.footerString] on the display itself wins over the global
     *   per-mode template. Used by the tab list, which owns "Tab Footer Format".
     */
    fun footerTemplateFor(gameMode: GameMode, config: DisplayConfig, preferDisplayFooter: Boolean = false): String {
        if (preferDisplayFooter) {
            config.footerString?.takeIf { it.isNotBlank() }?.let { return it }
        }
        return when (gameMode) {
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
    }

    /**
     * Set once OneConfig has finished loading so the save override cannot touch
     * the display manager during construction.
     */
    @Transient
    private var runtimeReady: Boolean = false

    init {
        initialize()
        ensureInstallId()
        setupConditionalVisibility()
        runtimeReady = true
    }

    /**
     * OneConfig writes GUI edits into the fields reflectively and then calls
     * [save]. Clearing the formatted-tag caches here makes a footer/header/colour
     * change visible on the next refresh tick, without a second settings store.
     */
    override fun save() {
        super.save()
        if (!runtimeReady) return
        TagFormatter.invalidate()
    }

    private fun setupConditionalVisibility() {
        hideIf("proxyBaseUrl") { !showAdvancedOptions }
        hideIf("backendUrlInfo") { !showAdvancedOptions }
        hideIf("forceEnabled") { !showAdvancedOptions }

        hideIf("bedwarsCustomFooterFormat") { bedwarsStatMode != BedwarsStatMode.CUSTOM }
        hideIf("duelsCustomFooterFormat") { duelsStatMode != DuelsStatMode.CUSTOM }
        hideIf("skywarsCustomFooterFormat") { skywarsStatMode != SkyWarsStatMode.CUSTOM }
    }

    private fun ensureInstallId() {
        if (installId.isBlank()) {
            installId = UUID.randomUUID().toString().replace("-", "").lowercase(Locale.ROOT)
            save()
        }
    }

    private fun resetToDefaults() {
        bedwarsHeaderText = GameMode.BEDWARS.defaultHeader
        duelsHeaderText = GameMode.DUELS.defaultHeader
        skywarsHeaderText = GameMode.SKYWARS.defaultHeader
        headerColor = OneColor(85, 255, 255)
        footerColor = OneColor(255, 255, 85)
        tabFooterColor = OneColor(255, 255, 85)
        levelheadEnabled = true
        showTabStats = true
        displayPositionIndex = 0
        showSelf = true
        verticalOffset = 0.0f
        showBackground = true
        backgroundOpacity = 0.25f
        textShadow = true
        renderDistance = 64
        cacheSizeLimit = 500
        starCacheTtlMinutes = _DEFAULT_STAR_CACHE_TTL_MINUTES
        bedwarsStatDisplayIndex = BedwarsStatMode.STAR.ordinal
        duelsStatDisplayIndex = DuelsStatMode.DIVISION_TITLE.ordinal
        skywarsStatDisplayIndex = SkyWarsStatMode.STAR.ordinal
        bedwarsCustomFooterFormat = "%star%"
        duelsCustomFooterFormat = "%division%"
        skywarsCustomFooterFormat = "%star%"
        tabFooterFormat = ""
        tabShowSelf = true
        showAdvancedOptions = false
        debugRequests = false
        proxyBaseUrl = DEFAULT_PROXY_URL
        forceEnabled = false
        save()
        BedwarsFetcher.resetWarnings()
        Levelhead.displayManager.clearCache()
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
