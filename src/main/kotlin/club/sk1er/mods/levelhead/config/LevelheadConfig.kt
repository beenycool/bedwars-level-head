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
    var enabled: Boolean = true

    @Text(name = "Hypixel API Key", placeholder = "Run /api new", secure = true)
    var apiKey: String = ""

    @Header(text = "Display Settings", category = "Display")

    @Slider(
        name = "Text Scale",
        min = 0.5f,
        max = 3.0f,
        step = 1,
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
        ensureInstallId()
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
