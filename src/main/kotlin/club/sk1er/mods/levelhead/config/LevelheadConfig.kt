package club.sk1er.mods.levelhead.config

import club.sk1er.mods.levelhead.bedwars.BedwarsFetcher
import org.polyfrost.oneconfig.api.config.v1.annotations.*
import org.polyfrost.oneconfig.api.platform.v1.Platform
import org.polyfrost.oneconfig.api.config.v1.Category
import java.time.Duration
import java.util.UUID

object LevelheadConfig {
    
    const val MIN_STAR_CACHE_TTL_MINUTES = 5
    const val MAX_STAR_CACHE_TTL_MINUTES = 180
    const val DEFAULT_STAR_CACHE_TTL_MINUTES = 45

    // General category configuration
    @Config(title = "General", description = "General settings for BedWars Levelhead")
    object General {
        
        @Text(
            title = "Hypixel API Key", 
            description = "Hypixel API key used for BedWars integrations",
            placeholder = "Enter your API key here",
            secure = true
        )
        var apiKey: String = ""
        
        @Switch(
            title = "Enable Proxy",
            description = "Enable fetching BedWars stats from a proxy backend"
        )
        var proxyEnabled: Boolean = true
        
        @Text(
            title = "Proxy Base URL", 
            description = "Base URL for the proxy backend (e.g. https://example.com)",
            placeholder = "https://beeny.hackclub.app"
        )
        @DependsOn("proxyEnabled")
        var proxyBaseUrl: String = "https://beeny.hackclub.app"
        
        @Text(
            title = "Proxy Auth Token", 
            description = "Bearer token used to authenticate with the proxy backend",
            secure = true
        )
        @DependsOn("proxyEnabled")
        var proxyAuthToken: String = ""
        
        @Text(
            title = "Install ID", 
            description = "Unique identifier for this BedWars Levelhead installation",
            readOnly = true
        )
        var installId: String = ""
        
        @Slider(
            title = "Star Cache Duration", 
            description = "Duration (in minutes) to cache BedWars stars locally before revalidating with the proxy/Hypixel",
            min = MIN_STAR_CACHE_TTL_MINUTES.toFloat(), 
            max = MAX_STAR_CACHE_TTL_MINUTES.toFloat(),
            step = 1f
        )
        var starCacheTtlMinutes: Int = DEFAULT_STAR_CACHE_TTL_MINUTES
        
        // Hidden field to track if welcome message was shown
        var welcomeMessageShown: Boolean = false
        
        init {
            // Generate install ID if not present
            if (installId.isBlank()) {
                installId = UUID.randomUUID().toString().replace("-", "")
            }
        }
    }
    
    // Computed properties for compatibility
    val starCacheTtl: Duration
        get() = Duration.ofMinutes(General.starCacheTtlMinutes.toLong())
    
    // API functions for compatibility with existing code
    fun setApiKey(newKey: String) {
        General.apiKey = newKey
        if (newKey.isBlank()) {
            ApiKeyStore.clear()
        } else {
            // Save to legacy for compatibility and set in OneConfig
            ApiKeyStore.saveToLegacy(newKey)
        }
        BedwarsFetcher.resetWarnings()
    }
    
    fun clearApiKey() {
        setApiKey("")
    }
    
    fun setProxyEnabled(enabled: Boolean) {
        General.proxyEnabled = enabled
        BedwarsFetcher.resetWarnings()
    }
    
    fun setProxyBaseUrl(baseUrl: String) {
        General.proxyBaseUrl = baseUrl
        BedwarsFetcher.resetWarnings()
    }
    
    fun setProxyAuthToken(authToken: String) {
        General.proxyAuthToken = authToken
        BedwarsFetcher.resetWarnings()
    }
    
    fun setStarCacheTtlMinutes(minutes: Int) {
        General.starCacheTtlMinutes = minutes.coerceIn(MIN_STAR_CACHE_TTL_MINUTES, MAX_STAR_CACHE_TTL_MINUTES)
        BedwarsFetcher.resetWarnings()
    }
    
    fun setWelcomeMessageShown(shown: Boolean) {
        General.welcomeMessageShown = shown
    }
    
    // Properties for compatibility
    val apiKeyValue: String
        get() = General.apiKey
        
    val proxyEnabledValue: Boolean
        get() = General.proxyEnabled
        
    val proxyBaseUrlValue: String
        get() = General.proxyBaseUrl
        
    val proxyAuthTokenValue: String
        get() = General.proxyAuthToken
        
    val installIdValue: String
        get() = General.installId
        
    val welcomeMessageShownValue: Boolean
        get() = General.welcomeMessageShown
        
    val starCacheTtlMinutesValue: Int
        get() = General.starCacheTtlMinutes
    
    // Migration function to be called during mod initialization
    fun initialize() {
        // Migrate API key from legacy storage if needed and OneConfig field is empty
        if (General.apiKey.isBlank()) {
            ApiKeyStore.migrateToOneConfig { key -> 
                General.apiKey = key 
            }
        }
    }
}
