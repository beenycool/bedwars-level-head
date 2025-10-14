package club.sk1er.mods.levelhead.config

import club.sk1er.mods.levelhead.bedwars.BedwarsFetcher
import net.minecraftforge.common.config.Configuration
import java.io.File

object LevelheadConfig {
    private const val CATEGORY_GENERAL = "general"
    private const val PROPERTY_API_KEY = "hypixelApiKey"
    private const val API_KEY_COMMENT = "Hypixel API key used for BedWars integrations"
    private const val PROPERTY_BEDWARS_ENABLED = "bedwarsIntegrationEnabled"
    private const val BEDWARS_ENABLED_COMMENT = "Enable fetching and rendering BedWars stars"

    private lateinit var configuration: Configuration

    var apiKey: String = ""
        private set

    var bedwarsIntegrationEnabled: Boolean = true
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

        val enabledProperty = configuration.get(
            CATEGORY_GENERAL,
            PROPERTY_BEDWARS_ENABLED,
            true,
            BEDWARS_ENABLED_COMMENT
        )
        bedwarsIntegrationEnabled = enabledProperty.boolean
        if (configuration.hasChanged()) {
            configuration.save()
        }
    }

    fun setApiKey(newKey: String) {
        ensureInitialized()
        val sanitized = newKey.trim()
        val property = configuration.get(CATEGORY_GENERAL, PROPERTY_API_KEY, "", API_KEY_COMMENT)
        property.set(sanitized)
        apiKey = sanitized
        configuration.save()
        BedwarsFetcher.resetWarnings()
    }

    fun clearApiKey() {
        setApiKey("")
    }

    fun setBedwarsIntegrationEnabled(enabled: Boolean) {
        ensureInitialized()
        val property = configuration.get(
            CATEGORY_GENERAL,
            PROPERTY_BEDWARS_ENABLED,
            true,
            BEDWARS_ENABLED_COMMENT
        )
        property.set(enabled)
        bedwarsIntegrationEnabled = enabled
        configuration.save()
    }

    private fun ensureInitialized() {
        check(::configuration.isInitialized) { "LevelheadConfig has not been initialized yet" }
    }
}
