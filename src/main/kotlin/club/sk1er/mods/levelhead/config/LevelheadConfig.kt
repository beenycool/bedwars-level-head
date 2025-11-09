package club.sk1er.mods.levelhead.config

import org.polyfrost.oneconfig.api.config.v1.Config
import org.polyfrost.oneconfig.api.config.v1.ConfigCategory
import org.polyfrost.oneconfig.api.config.v1.Option
import org.polyfrost.oneconfig.api.config.v1.OptionType
import org.polyfrost.oneconfig.api.config.v1.options.BooleanOption
import org.polyfrost.oneconfig.api.config.v1.options.NumberOption
import org.polyfrost.oneconfig.api.config.v1.options.StringOption
import java.io.File

object LevelheadConfig : Config("bedwars_levelhead", "BedWars Levelhead") {

    private val general: ConfigCategory = category("General")
    private val display: ConfigCategory = category("Display")
    private val proxy: ConfigCategory = category("Proxy")

    @Option(
        type = OptionType.BOOLEAN,
        name = "Show welcome message",
        description = "Show first-time welcome messages.",
        category = "General"
    )
    @JvmField
    var welcomeMessageShown: Boolean = false

    @Option(
        type = OptionType.STRING,
        name = "Hypixel API Key",
        description = "Used when querying Hypixel directly (without proxy). Leave blank to disable direct queries.",
        category = "General"
    )
    @JvmField
    var apiKey: String = ""

    @Option(
        type = OptionType.BOOLEAN,
        name = "Enable proxy",
        description = "Use a backend proxy for BedWars stats.",
        category = "Proxy"
    )
    @JvmField
    var proxyEnabled: Boolean = false

    @Option(
        type = OptionType.STRING,
        name = "Proxy base URL",
        description = "Base URL of the stats proxy, e.g. https://example.com",
        category = "Proxy"
    )
    @JvmField
    var proxyBaseUrl: String = ""

    @Option(
        type = OptionType.STRING,
        name = "Proxy auth token",
        description = "Bearer token used to authenticate with the proxy.",
        category = "Proxy"
    )
    @JvmField
    var proxyAuthToken: String = ""

    @Option(
        type = OptionType.NUMBER,
        name = "Star cache TTL (minutes)",
        description = "How long to cache fetched BedWars stars.",
        min = 1.0,
        max = 1440.0,
        category = "General"
    )
    @JvmField
    var starCacheTtlMinutes: Int = 30

    fun initialize(configFile: File) {
        // For OneConfig, file path is managed by the library; this exists for legacy compatibility.
        load()
    }

    fun setApiKey(key: String) {
        apiKey = key
        save()
    }

    fun clearApiKey() {
        apiKey = ""
        save()
    }

    fun setProxyEnabled(enabled: Boolean) {
        proxyEnabled = enabled
        save()
    }

    fun setProxyBaseUrl(url: String) {
        proxyBaseUrl = url
        save()
    }

    fun setProxyAuthToken(token: String) {
        proxyAuthToken = token
        save()
    }

    fun setStarCacheTtlMinutes(minutes: Int) {
        starCacheTtlMinutes = minutes
        save()
    }

    fun setWelcomeMessageShown(shown: Boolean) {
        welcomeMessageShown = shown
        save()
    }
}
