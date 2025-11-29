package club.sk1er.mods.levelhead.config

import cc.polyfrost.oneconfig.config.Config
import cc.polyfrost.oneconfig.config.annotations.Color
import cc.polyfrost.oneconfig.config.annotations.Header
import cc.polyfrost.oneconfig.config.annotations.Slider
import cc.polyfrost.oneconfig.config.annotations.Switch
import cc.polyfrost.oneconfig.config.annotations.Text
import cc.polyfrost.oneconfig.config.core.OneColor
import cc.polyfrost.oneconfig.config.data.Mod
import cc.polyfrost.oneconfig.config.data.ModType
import club.sk1er.mods.levelhead.Levelhead
import club.sk1er.mods.levelhead.bedwars.BedwarsFetcher
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

    @Switch(name = "Use Proxy", description = "Route requests through the Levelhead backend")
    var proxyEnabled: Boolean = true

    @Text(name = "Proxy Base URL", placeholder = DEFAULT_PROXY_URL)
    var proxyBaseUrl: String = DEFAULT_PROXY_URL

    @Text(name = "Proxy Auth Token", secure = true)
    var proxyAuthToken: String = ""

    @Slider(
        name = "Star Cache TTL (minutes)",
        min = 5f,
        max = 180f,
        step = 1
    )
    var starCacheTtlMinutes: Int = DEFAULT_STAR_CACHE_TTL_MINUTES

    @Switch(name = "Use Threat Colors", description = "Color stats based on FKDR")
    var useThreatColor: Boolean = false

    @Header(text = "Display")
    @Text(name = "Header Text")
    var headerString: String = "BedWars Star"

    @Color(name = "Header Color")
    var headerColor: OneColor = OneColor(85, 255, 255)

    @Text(name = "Footer Template", description = "Supports %star%, %fkdr%, %ws%")
    var footerTemplate: String = "%star%"

    @Color(name = "Footer Color")
    var footerColor: OneColor = OneColor(255, 255, 85)

    @Switch(name = "Show Self")
    var showSelf: Boolean = true

    @Switch(name = "Footer Chroma")
    var footerChroma: Boolean = false

    @Switch(name = "Header Chroma")
    var headerChroma: Boolean = false

    @Slider(
        name = "Y Offset",
        min = -2f,
        max = 3f,
        step = 1
    )
    var offset: Float = 0.5f

    @Switch(name = "Use Custom Icon", description = "Render a local PNG instead of the star text")
    var customIconEnabled: Boolean = false

    @Text(
        name = "Custom Icon Path",
        placeholder = "C:/Users/You/Pictures/icon.png",
        description = "Absolute path to a PNG file"
    )
    var customIconPath: String = ""

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

    fun updateStarCacheTtlMinutes(minutes: Int) {
        val clamped = minutes.coerceIn(MIN_STAR_CACHE_TTL_MINUTES, MAX_STAR_CACHE_TTL_MINUTES)
        starCacheTtlMinutes = clamped
        save()
        BedwarsFetcher.resetWarnings()
    }

    override fun save() {
        super.save()
        Levelhead.applyDisplayConfigFromSettings()
    }
}
