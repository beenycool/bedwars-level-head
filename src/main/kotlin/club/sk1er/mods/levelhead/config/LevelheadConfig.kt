package club.sk1er.mods.levelhead.config

import club.sk1er.mods.levelhead.bedwars.BedwarsFetcher
import net.minecraftforge.common.config.Configuration
import java.io.File
import java.time.Duration
import java.util.UUID

object LevelheadConfig {
    private const val CATEGORY_GENERAL = "general"
    private const val PROPERTY_API_KEY = "hypixelApiKey"
    private const val PROPERTY_PROXY_ENABLED = "proxyEnabled"
    private const val PROPERTY_PROXY_BASE_URL = "proxyBaseUrl"
    private const val PROPERTY_PROXY_AUTH_TOKEN = "proxyAuthToken"
    private const val PROPERTY_INSTALL_ID = "installId"
    private const val PROPERTY_STAR_CACHE_TTL_MINUTES = "starCacheTtlMinutes"
    private const val API_KEY_COMMENT = "Hypixel API key used for BedWars integrations"
    private const val PROXY_ENABLED_COMMENT = "Enable fetching BedWars stats from a proxy backend"
    private const val PROXY_BASE_URL_COMMENT = "Base URL for the proxy backend (e.g. https://example.com)"
    private const val PROXY_AUTH_TOKEN_COMMENT = "Bearer token used to authenticate with the proxy backend"
    private const val INSTALL_ID_COMMENT = "Unique identifier for this BedWars Levelhead installation"
    private const val STAR_CACHE_TTL_COMMENT =
        "Duration (in minutes) to cache BedWars stars locally before revalidating with the proxy/Hypixel"

    const val MIN_STAR_CACHE_TTL_MINUTES = 5
    const val MAX_STAR_CACHE_TTL_MINUTES = 180
    const val DEFAULT_STAR_CACHE_TTL_MINUTES = 45

    private lateinit var configuration: Configuration

    var apiKey: String = ""
        private set

    var proxyEnabled: Boolean = false
        private set

    var proxyBaseUrl: String = ""
        private set

    var proxyAuthToken: String = ""
        private set

    var installId: String = ""
        private set

    var starCacheTtlMinutes: Int = DEFAULT_STAR_CACHE_TTL_MINUTES
        private set

    val starCacheTtl: Duration
        get() = Duration.ofMinutes(starCacheTtlMinutes.toLong())

    fun initialize(configFile: File) {
        configFile.parentFile?.takeIf { !it.exists() }?.mkdirs()
        configuration = Configuration(configFile)
        val keyStoreDirectory = configFile.parentFile ?: configFile
        val keyStoreFile = File(keyStoreDirectory, "bedwars-levelhead-apikey.json")
        ApiKeyStore.initialize(keyStoreFile)
        load()
    }

    private fun load() {
        configuration.load()
        val apiKeyProperty = configuration.get(CATEGORY_GENERAL, PROPERTY_API_KEY, "", API_KEY_COMMENT)
        val persistedKey = ApiKeyStore.load()
        val propertyKey = apiKeyProperty.string.trim()
        apiKey = when {
            !persistedKey.isNullOrBlank() -> persistedKey
            propertyKey.isNotEmpty() -> propertyKey
            else -> ""
        }
        if (!persistedKey.isNullOrBlank() && persistedKey != propertyKey) {
            apiKeyProperty.set(persistedKey)
        }

        val proxyEnabledProperty = configuration.get(CATEGORY_GENERAL, PROPERTY_PROXY_ENABLED, false, PROXY_ENABLED_COMMENT)
        proxyEnabled = proxyEnabledProperty.boolean

        val proxyBaseUrlProperty = configuration.get(CATEGORY_GENERAL, PROPERTY_PROXY_BASE_URL, "", PROXY_BASE_URL_COMMENT)
        proxyBaseUrl = proxyBaseUrlProperty.string.trim()

        val proxyAuthTokenProperty = configuration.get(CATEGORY_GENERAL, PROPERTY_PROXY_AUTH_TOKEN, "", PROXY_AUTH_TOKEN_COMMENT)
        proxyAuthToken = proxyAuthTokenProperty.string.trim()

        val installIdProperty = configuration.get(CATEGORY_GENERAL, PROPERTY_INSTALL_ID, "", INSTALL_ID_COMMENT)
        val existingInstallId = installIdProperty.string.trim()
        if (existingInstallId.isBlank()) {
            val generated = UUID.randomUUID().toString().replace("-", "")
            installIdProperty.set(generated)
            installId = generated
        } else {
            installId = existingInstallId
        }

        val starCacheTtlProperty = configuration.get(
            CATEGORY_GENERAL,
            PROPERTY_STAR_CACHE_TTL_MINUTES,
            DEFAULT_STAR_CACHE_TTL_MINUTES,
            STAR_CACHE_TTL_COMMENT
        )
        val configuredTtl = starCacheTtlProperty.int
        val sanitizedTtl = configuredTtl.coerceIn(MIN_STAR_CACHE_TTL_MINUTES, MAX_STAR_CACHE_TTL_MINUTES)
        starCacheTtlMinutes = sanitizedTtl
        if (sanitizedTtl != configuredTtl) {
            starCacheTtlProperty.set(sanitizedTtl)
        }
        if (configuration.hasChanged()) {
            configuration.save()
        }
    }

    fun setApiKey(newKey: String) {
        updateStringConfig(PROPERTY_API_KEY, API_KEY_COMMENT, newKey) { value ->
            apiKey = value
            if (value.isBlank()) {
                ApiKeyStore.clear()
            } else {
                ApiKeyStore.save(value)
            }
        }
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

    fun setStarCacheTtlMinutes(minutes: Int) {
        val sanitized = minutes.coerceIn(MIN_STAR_CACHE_TTL_MINUTES, MAX_STAR_CACHE_TTL_MINUTES)
        updateIntConfig(PROPERTY_STAR_CACHE_TTL_MINUTES, STAR_CACHE_TTL_COMMENT, sanitized) {
            starCacheTtlMinutes = it
        }
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

    private fun updateIntConfig(
        key: String,
        comment: String,
        value: Int,
        setter: (Int) -> Unit,
    ) {
        ensureInitialized()
        val property = configuration.get(CATEGORY_GENERAL, key, value, comment)
        property.set(value)
        setter(value)
        configuration.save()
        BedwarsFetcher.resetWarnings()
    }

    private fun ensureInitialized() {
        check(::configuration.isInitialized) { "LevelheadConfig has not been initialized yet" }
    }
}
