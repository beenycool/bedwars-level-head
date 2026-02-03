package club.sk1er.mods.levelhead.config

import club.sk1er.mods.levelhead.Levelhead
import club.sk1er.mods.levelhead.core.GameMode
import club.sk1er.mods.levelhead.core.ModeManager
import club.sk1er.mods.levelhead.display.AboveHeadDisplay
import com.google.gson.JsonSyntaxException
import java.awt.Color

object ConfigProfiles {
    data class Profile(
        val name: String,
        val master: MasterConfig,
        val displays: List<DisplayConfig>,
    )

    enum class Preset(val displayName: String, val description: String) {
        DEFAULT("Default", "BedWars defaults with a star footer"),
        COMPACT("Compact", "Tighter spacing with smaller font size"),
    }

    fun getPreset(preset: Preset): Profile {
        val master = MasterConfig()
        val display = DisplayConfig()
        return when (preset) {
            Preset.DEFAULT -> Profile(
                name = preset.displayName,
                master = master,
                displays = listOf(display),
            )
            Preset.COMPACT -> Profile(
                name = preset.displayName,
                master = master.apply {
                    fontSize = 0.85
                    offset = -0.1
                },
                displays = listOf(display.apply {
                    headerString = GameMode.BEDWARS.defaultHeader
                    footerString = "%star%"
                }),
            )
        }
    }

    fun applyProfile(profile: Profile) {
        val manager = Levelhead.displayManager
        manager.config = cloneMaster(profile.master)
        manager.aboveHead.clear()
        profile.displays.forEach { displayConfig ->
            manager.aboveHead.add(AboveHeadDisplay(cloneDisplay(displayConfig)))
        }
        manager.adjustIndices()
        manager.saveConfig()
        manager.clearCachesWithoutRefetch()
        if (manager.config.enabled && ModeManager.shouldRequestData()) {
            manager.requestAllDisplays()
        }
    }

    fun exportProfile(): String {
        val manager = Levelhead.displayManager
        val snapshot = Profile(
            name = "Exported Profile",
            master = cloneMaster(manager.config),
            displays = manager.aboveHead.map { cloneDisplay(it.config) },
        )
        return Levelhead.gson.toJson(snapshot)
    }

    fun importProfile(serialized: String): Profile? {
        return try {
            Levelhead.gson.fromJson(serialized, Profile::class.java)
        } catch (ex: JsonSyntaxException) {
            Levelhead.logger.warn(
                "Failed to import profile: ${ex.message}. Payload preview: ${serialized.take(200)}",
                ex,
            )
            null
        }
    }

    private fun cloneMaster(master: MasterConfig): MasterConfig {
        return MasterConfig().apply {
            enabled = master.enabled
            fontSize = master.fontSize
            offset = master.offset
            displayPosition = master.displayPosition
            renderDistance = master.renderDistance
            purgeSize = master.purgeSize
            backgroundOpacity = master.backgroundOpacity
            showBackground = master.showBackground
            renderThrottleMs = master.renderThrottleMs
            frameSkip = master.frameSkip
            textShadow = master.textShadow
        }
    }

    private fun cloneDisplay(display: DisplayConfig): DisplayConfig {
        return DisplayConfig().apply {
            enabled = display.enabled
            showSelf = display.showSelf
            type = display.type
            headerColor = cloneColor(display.headerColor)
            headerString = display.headerString
            footerColor = cloneColor(display.footerColor)
            footerString = display.footerString
        }
    }

    private fun cloneColor(color: Color): Color = Color(color.rgb, true)
}
