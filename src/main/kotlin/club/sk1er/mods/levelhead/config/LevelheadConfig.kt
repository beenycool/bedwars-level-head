package club.sk1er.mods.levelhead.config

import club.sk1er.mods.levelhead.bedwars.BedwarsFetcher
import net.minecraftforge.common.config.Configuration
import java.io.File

object LevelheadConfig {
    private const val CATEGORY_GENERAL = "general"
    private const val PROPERTY_API_KEY = "hypixelApiKey"
    private const val PROPERTY_PROXY_ENABLED = "proxyEnabled"
    private const val PROPERTY_PROXY_BASE_URL = "proxyBaseUrl"
    private const val PROPERTY_PROXY_AUTH_TOKEN = "proxyAuthToken"
    private const val API_KEY_COMMENT = "Hypixel API key used for BedWars integrations"
    private const val PROXY_ENABLED_COMMENT = "Enable fetching BedWars stats from a proxy backend"
    private const val PROXY_BASE_URL_COMMENT = "Base URL for the proxy backend (e.g. https://example.com)"
    private const val PROXY_AUTH_TOKEN_COMMENT = "Bearer token used to authenticate with the proxy backend"

    private lateinit var configuration: Configuration

    var apiKey: String = ""
        private set

    var proxyEnabled: Boolean = false
        private set

    var proxyBaseUrl: String = ""
        private set

    var proxyAuthToken: String = ""
        private set

    fun initialize(configFile: File) {
        configFile.parentFile?.takeIf { !it.exists() }?.mkdirs()
        configuration = Configuration(configFile)
        load()
    }

    private fun load() {
        configuration.load()
        val apiKeyProperty = configuration.get(CATEGORY_GENERAL, PROPERTY_API_KEY, "", API_KEY_COMMENT)
        apiKey = apiKeyProperty.string.trim()

        val proxyEnabledProperty = configuration.get(CATEGORY_GENERAL, PROPERTY_PROXY_ENABLED, false, PROXY_ENABLED_COMMENT)
        proxyEnabled = proxyEnabledProperty.boolean

        val proxyBaseUrlProperty = configuration.get(CATEGORY_GENERAL, PROPERTY_PROXY_BASE_URL, "", PROXY_BASE_URL_COMMENT)
        proxyBaseUrl = proxyBaseUrlProperty.string.trim()

        val proxyAuthTokenProperty = configuration.get(CATEGORY_GENERAL, PROPERTY_PROXY_AUTH_TOKEN, "", PROXY_AUTH_TOKEN_COMMENT)
        proxyAuthToken = proxyAuthTokenProperty.string.trim()
        if (configuration.hasChanged()) {
            configuration.save()
        }
    }

    fun setApiKey(newKey: String) {
        updateStringConfig(PROPERTY_API_KEY, API_KEY_COMMENT, newKey) { apiKey = it }
    }

    fun clearApiKey() {
        setApiKey("")
    }

    fun setProxyEnabled(enabled: Boolean) {
        updateBooleanConfig(PROPERTY_PROXY_ENABLED, PROXY_ENABLED_COMMENT, enabled) { proxyEnabled = it }
    }

    fun setProxyBaseUrl(baseUrl: String) {
        updateStringConfig(PROPERTY_PROXY_BASE_URL, PROXY_BASE_URL_COMMENT, baseUrl) { proxyBaseUrl = it }
    }

    fun setProxyAuthToken(authToken: String) {
        updateStringConfig(PROPERTY_PROXY_AUTH_TOKEN, PROXY_AUTH_TOKEN_COMMENT, authToken) { proxyAuthToken = it }
    }

    private fun updateStringConfig(
        key: String,
        comment: String,
        value: String,
        setter: (String) -> Unit,
    ) {
        ensureInitialized()
        val sanitized = value.trim()
        val property = configuration.get(CATEGORY_GENERAL, key, "", comment)
        property.set(sanitized)
        setter(sanitized)
        configuration.save()
        BedwarsFetcher.resetWarnings()
    }

    private fun updateBooleanConfig(
        key: String,
        comment: String,
        value: Boolean,
        setter: (Boolean) -> Unit,
    ) {
        ensureInitialized()
        val property = configuration.get(CATEGORY_GENERAL, key, false, comment)
        property.set(value)
        setter(value)
        configuration.save()
        BedwarsFetcher.resetWarnings()
    }

    private fun ensureInitialized() {
        check(::configuration.isInitialized) { "LevelheadConfig has not been initialized yet" }
    }
}
