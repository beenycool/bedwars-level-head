package club.sk1er.mods.levelhead.config

import club.sk1er.mods.levelhead.Levelhead
import club.sk1er.mods.levelhead.core.GameMode
import com.google.gson.JsonObject
import java.awt.Color
import java.io.File
import java.nio.charset.StandardCharsets
import org.apache.commons.io.FileUtils

/**
 * Configuration profiles for common use cases.
 * Allows users to quickly switch between different display configurations.
 */
object ConfigProfiles {

    /**
     * Predefined profile configurations.
     */
    enum class Preset(
        val displayName: String,
        val description: String
    ) {
        MINIMAL(
            displayName = "Minimal",
            description = "Clean display with just star level"
        ),
        COMPETITIVE(
            displayName = "Competitive",
            description = "Shows star, FKDR, and winstreak for competitive play"
        ),
        STREAMER(
            displayName = "Streamer",
            description = "Large text for stream visibility"
        ),
        PERFORMANCE(
            displayName = "Performance",
            description = "Optimized settings for lower-end systems"
        ),
        CUSTOM(
            displayName = "Custom",
            description = "Your custom saved configuration"
        );

        companion object {
            fun fromIndex(index: Int): Preset = entries.getOrNull(index) ?: MINIMAL
            fun displayNames(): List<String> = entries.map { it.displayName }
        }
    }

    /**
     * Data class representing a configuration profile.
     */
    data class Profile(
        val name: String,
        val headerString: String,
        val headerColor: Color,
        val footerString: String,
        val footerColor: Color,
        val showSelf: Boolean,
        val renderDistance: Int,
        val showBackground: Boolean,
        val backgroundOpacity: Float,
        val textShadow: Boolean,
        val fontSize: Double,
        val backendModeIndex: Int,
        val gameModeIndex: Int
    )

    /**
     * Get a preset configuration.
     */
    fun getPreset(preset: Preset): Profile {
        return when (preset) {
            Preset.MINIMAL -> Profile(
                name = "Minimal",
                headerString = "★",
                headerColor = Color(170, 170, 170),
                footerString = "%star%",
                footerColor = Color(255, 255, 85),
                showSelf = false,
                renderDistance = 32,
                showBackground = false,
                backgroundOpacity = 0.0f,
                textShadow = true,
                fontSize = 1.0,
                backendModeIndex = 2, // Fallback
                gameModeIndex = 0 // BedWars
            )
            Preset.COMPETITIVE -> Profile(
                name = "Competitive",
                headerString = "BedWars",
                headerColor = Color(85, 255, 255),
                footerString = "%star% | %fkdr% FKDR | WS: %ws%",
                footerColor = Color(255, 255, 85),
                showSelf = true,
                renderDistance = 64,
                showBackground = true,
                backgroundOpacity = 0.25f,
                textShadow = true,
                fontSize = 1.0,
                backendModeIndex = 2, // Fallback
                gameModeIndex = 0 // BedWars
            )
            Preset.STREAMER -> Profile(
                name = "Streamer",
                headerString = "BedWars Star",
                headerColor = Color(255, 85, 255),
                footerString = "%star%",
                footerColor = Color(255, 255, 85),
                showSelf = true,
                renderDistance = 48,
                showBackground = true,
                backgroundOpacity = 0.35f,
                textShadow = true,
                fontSize = 1.2,
                backendModeIndex = 0, // Proxy only (lower latency)
                gameModeIndex = 0 // BedWars
            )
            Preset.PERFORMANCE -> Profile(
                name = "Performance",
                headerString = "★",
                headerColor = Color(170, 170, 170),
                footerString = "%star%",
                footerColor = Color(255, 255, 85),
                showSelf = false,
                renderDistance = 16,
                showBackground = false,
                backgroundOpacity = 0.0f,
                textShadow = false,
                fontSize = 0.9,
                backendModeIndex = 0, // Proxy only (less API calls)
                gameModeIndex = 0 // BedWars
            )
            Preset.CUSTOM -> {
                // Return current settings as a custom profile
                currentProfileSnapshot()
            }
        }
    }

    /**
     * Apply a profile to the current configuration.
     */
    fun applyProfile(profile: Profile) {
        val displayManager = Levelhead.displayManager
        val primaryDisplay = displayManager.primaryDisplay() ?: return

        // Update display config
        primaryDisplay.config.headerString = profile.headerString
        primaryDisplay.config.headerColor = profile.headerColor
        primaryDisplay.config.footerString = profile.footerString
        primaryDisplay.config.footerColor = profile.footerColor
        primaryDisplay.config.showSelf = profile.showSelf
        primaryDisplay.config.gameMode = GameMode.entries.getOrNull(profile.gameModeIndex) ?: GameMode.BEDWARS

        // Update master config
        displayManager.config.renderDistance = profile.renderDistance
        displayManager.config.showBackground = profile.showBackground
        displayManager.config.backgroundOpacity = profile.backgroundOpacity
        displayManager.config.textShadow = profile.textShadow
        displayManager.config.fontSize = profile.fontSize

        // Update LevelheadConfig
        LevelheadConfig.backendModeIndex = profile.backendModeIndex
        LevelheadConfig.gameModeIndex = profile.gameModeIndex
        LevelheadConfig.showSelf = profile.showSelf

        // Save and refresh
        displayManager.saveConfig()
        LevelheadConfig.save()
        displayManager.applyPrimaryDisplayConfigToCache()
        displayManager.clearCache()
    }

    /**
     * Get a snapshot of the current configuration as a profile.
     */
    fun currentProfileSnapshot(): Profile {
        val displayManager = Levelhead.displayManager
        val primaryDisplay = displayManager.primaryDisplay()

        return Profile(
            name = "Custom",
            headerString = primaryDisplay?.config?.headerString ?: GameMode.BEDWARS.defaultHeader,
            headerColor = primaryDisplay?.config?.headerColor ?: Color(85, 255, 255),
            footerString = primaryDisplay?.config?.footerString ?: "%star%",
            footerColor = primaryDisplay?.config?.footerColor ?: Color(255, 255, 85),
            showSelf = primaryDisplay?.config?.showSelf ?: true,
            renderDistance = displayManager.config.renderDistance,
            showBackground = displayManager.config.showBackground,
            backgroundOpacity = displayManager.config.backgroundOpacity,
            textShadow = displayManager.config.textShadow,
            fontSize = displayManager.config.fontSize,
            backendModeIndex = LevelheadConfig.backendModeIndex,
            gameModeIndex = LevelheadConfig.gameModeIndex
        )
    }

    /**
     * Export current configuration to a JSON string.
     */
    fun exportProfile(): String {
        val profile = currentProfileSnapshot()
        val json = JsonObject().apply {
            addProperty("name", profile.name)
            addProperty("headerString", profile.headerString)
            addProperty("headerColorRgb", profile.headerColor.rgb)
            addProperty("footerString", profile.footerString)
            addProperty("footerColorRgb", profile.footerColor.rgb)
            addProperty("showSelf", profile.showSelf)
            addProperty("renderDistance", profile.renderDistance)
            addProperty("showBackground", profile.showBackground)
            addProperty("backgroundOpacity", profile.backgroundOpacity)
            addProperty("textShadow", profile.textShadow)
            addProperty("fontSize", profile.fontSize)
            addProperty("backendModeIndex", profile.backendModeIndex)
            addProperty("gameModeIndex", profile.gameModeIndex)
            addProperty("version", 1)
        }
        return Levelhead.gson.toJson(json)
    }

    /**
     * Import a configuration from a JSON string.
     * Returns the profile if valid, null otherwise.
     */
    fun importProfile(jsonString: String): Profile? {
        return try {
            val json = Levelhead.jsonParser.parse(jsonString).asJsonObject
            Profile(
                name = json.get("name")?.asString ?: "Imported",
                headerString = json.get("headerString")?.asString ?: GameMode.BEDWARS.defaultHeader,
                headerColor = Color(json.get("headerColorRgb")?.asInt ?: Color(85, 255, 255).rgb),
                footerString = json.get("footerString")?.asString ?: "%star%",
                footerColor = Color(json.get("footerColorRgb")?.asInt ?: Color(255, 255, 85).rgb),
                showSelf = json.get("showSelf")?.asBoolean ?: true,
                renderDistance = json.get("renderDistance")?.asInt ?: 64,
                showBackground = json.get("showBackground")?.asBoolean ?: true,
                backgroundOpacity = json.get("backgroundOpacity")?.asFloat ?: 0.25f,
                textShadow = json.get("textShadow")?.asBoolean ?: false,
                fontSize = json.get("fontSize")?.asDouble ?: 1.0,
                backendModeIndex = json.get("backendModeIndex")?.asInt ?: 2,
                gameModeIndex = json.get("gameModeIndex")?.asInt ?: 0
            )
        } catch (e: Exception) {
            Levelhead.logger.warn("Failed to import profile", e)
            null
        }
    }

    /**
     * Save a profile to a file.
     */
    fun saveProfileToFile(file: File, profile: Profile): Boolean {
        return try {
            val json = JsonObject().apply {
                addProperty("name", profile.name)
                addProperty("headerString", profile.headerString)
                addProperty("headerColorRgb", profile.headerColor.rgb)
                addProperty("footerString", profile.footerString)
                addProperty("footerColorRgb", profile.footerColor.rgb)
                addProperty("showSelf", profile.showSelf)
                addProperty("renderDistance", profile.renderDistance)
                addProperty("showBackground", profile.showBackground)
                addProperty("backgroundOpacity", profile.backgroundOpacity)
                addProperty("textShadow", profile.textShadow)
                addProperty("fontSize", profile.fontSize)
                addProperty("backendModeIndex", profile.backendModeIndex)
                addProperty("gameModeIndex", profile.gameModeIndex)
                addProperty("version", 1)
            }
            FileUtils.writeStringToFile(file, Levelhead.gson.toJson(json), StandardCharsets.UTF_8)
            true
        } catch (e: Exception) {
            Levelhead.logger.error("Failed to save profile to file", e)
            false
        }
    }

    /**
     * Load a profile from a file.
     */
    fun loadProfileFromFile(file: File): Profile? {
        return try {
            val content = FileUtils.readFileToString(file, StandardCharsets.UTF_8)
            importProfile(content)
        } catch (e: Exception) {
            Levelhead.logger.error("Failed to load profile from file", e)
            null
        }
    }
}
