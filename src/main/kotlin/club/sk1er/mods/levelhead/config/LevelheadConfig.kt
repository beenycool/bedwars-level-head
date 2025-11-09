package club.sk1er.mods.levelhead.config

import club.sk1er.mods.levelhead.Levelhead
import org.polyfrost.oneconfig.api.config.v1.Config
import org.polyfrost.oneconfig.api.config.v1.ConfigCategory
import org.polyfrost.oneconfig.api.config.v1.Option
import org.polyfrost.oneconfig.api.config.v1.OptionType
import org.polyfrost.oneconfig.api.config.v1.options.BooleanOption
import org.polyfrost.oneconfig.api.config.v1.options.NumberOption
import org.polyfrost.oneconfig.api.config.v1.options.StringOption
import java.io.File
import java.time.Duration
import java.util.UUID

object LevelheadConfig : Config("bedwars_levelhead", "BedWars Levelhead") {

    const val MIN_STAR_CACHE_TTL_MINUTES = 5
    const val MAX_STAR_CACHE_TTL_MINUTES = 180
    const val DEFAULT_STAR_CACHE_TTL_MINUTES = 45
    const val DEFAULT_PROXY_BASE_URL = "https://levelhead.beeny.cool"

    private val general: ConfigCategory = category("General")
    private val display: ConfigCategory = category("Display")
    private val proxy: ConfigCategory = category("Proxy")

    private lateinit var persistenceDirectory: File
    private lateinit var installIdFile: File

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
        description = "Use the Levelhead backend for BedWars stats.",
        category = "Proxy"
    )
    @JvmField
    var proxyEnabled: Boolean = true

    @Option(
        type = OptionType.STRING,
        name = "Proxy base URL",
        description = "Base URL of the stats proxy. Defaults to the public Levelhead backend.",
        category = "Proxy"
    )
    @JvmField
    var proxyBaseUrl: String = DEFAULT_PROXY_BASE_URL

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
        min = MIN_STAR_CACHE_TTL_MINUTES.toDouble(),
        max = MAX_STAR_CACHE_TTL_MINUTES.toDouble(),
        category = "General"
    )
    @JvmField
    var starCacheTtlMinutes: Int = DEFAULT_STAR_CACHE_TTL_MINUTES

    var installId: String = ""
        private set

    val starCacheTtl: Duration
        get() = Duration.ofMinutes(starCacheTtlMinutes.toLong())

    fun initialize(@Suppress("UNUSED_PARAMETER") configFile: File) {
        // For OneConfig, file path is managed by the library; this exists for legacy compatibility.
        persistenceDirectory = (configFile.parentFile ?: configFile.absoluteFile.parentFile)?.apply {
            if (!exists()) {
                mkdirs()
            }
        } ?: configFile.absoluteFile.parentFile ?: configFile

        val legacyConfigExists = configFile.exists()

        load()

        if (applyProxyDefaults(legacyConfigExists)) {
            save()
        }

        val keyStoreFile = File(persistenceDirectory, "bedwars-levelhead-apikey.json")
        ApiKeyStore.initialize(keyStoreFile)
        synchronizePersistedApiKey()

        installIdFile = File(persistenceDirectory, "bedwars-levelhead-install-id.txt")
        installId = readPersistedInstallId()
        if (installId.isBlank()) {
            installId = UUID.randomUUID().toString().replace("-", "")
            persistInstallId()
        }
    }

    fun setApiKey(key: String) {
        val sanitized = key.trim()
        apiKey = sanitized
        save()
        if (sanitized.isBlank()) {
            ApiKeyStore.clear()
        } else {
            ApiKeyStore.save(sanitized)
        }
    }

    fun clearApiKey() {
        apiKey = ""
        save()
        ApiKeyStore.clear()
    }

    fun setProxyEnabled(enabled: Boolean) {
        proxyEnabled = enabled
        save()
    }

    fun setProxyBaseUrl(url: String) {
        proxyBaseUrl = url.trim().trimEnd('/')
        save()
    }

    fun setProxyAuthToken(token: String) {
        proxyAuthToken = token.trim()
        save()
    }

    fun setStarCacheTtlMinutes(minutes: Int) {
        starCacheTtlMinutes = minutes.coerceIn(MIN_STAR_CACHE_TTL_MINUTES, MAX_STAR_CACHE_TTL_MINUTES)
        save()
    }

    fun setWelcomeMessageShown(shown: Boolean) {
        welcomeMessageShown = shown
        save()
    }

    private fun synchronizePersistedApiKey() {
        val persisted = ApiKeyStore.load()
        val configured = apiKey.trim()
        when {
            !persisted.isNullOrBlank() && persisted != configured -> {
                apiKey = persisted
                save()
            }
            persisted.isNullOrBlank() && configured.isNotEmpty() -> {
                ApiKeyStore.save(configured)
            }
            else -> Unit
        }
    }

    private fun applyProxyDefaults(legacyConfigExists: Boolean): Boolean {
        var mutated = false

        if (proxyBaseUrl.isBlank()) {
            proxyBaseUrl = DEFAULT_PROXY_BASE_URL
            mutated = true
        }

        if (!legacyConfigExists && !proxyEnabled) {
            proxyEnabled = true
            mutated = true
        }

        return mutated
    }

    private fun readPersistedInstallId(): String {
        return kotlin.runCatching {
            if (!::installIdFile.isInitialized || !installIdFile.exists()) {
                return ""
            }
            installIdFile.readText().trim()
        }.getOrElse { "" }
    }

    private fun persistInstallId() {
        if (!::installIdFile.isInitialized) return
        kotlin.runCatching {
            installIdFile.parentFile?.takeIf { !it.exists() }?.mkdirs()
            installIdFile.writeText(installId)
        }.onFailure { throwable ->
            Levelhead.logger.warn("Failed to persist Levelhead install ID", throwable)
        }
    }
}
