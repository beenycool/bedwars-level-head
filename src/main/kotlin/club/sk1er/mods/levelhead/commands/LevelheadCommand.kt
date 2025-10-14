package club.sk1er.mods.levelhead.commands

import club.sk1er.mods.levelhead.Levelhead
import club.sk1er.mods.levelhead.Levelhead.displayManager
import club.sk1er.mods.levelhead.Levelhead.types
import club.sk1er.mods.levelhead.config.LevelheadConfig
import club.sk1er.mods.levelhead.gui.LevelheadGUI
import gg.essential.api.EssentialAPI
import gg.essential.api.commands.Command
import gg.essential.api.commands.DefaultHandler
import gg.essential.api.commands.SubCommand
import gg.essential.universal.ChatColor
import kotlinx.coroutines.launch
import kotlinx.coroutines.cancelChildren
import java.util.Locale

class LevelheadCommand : Command("levelhead") {

    companion object {
        private val API_KEY_PATTERN = Regex("^[a-f0-9]{32}$", RegexOption.IGNORE_CASE)
        private var remindedAboutApiKey = false
    }

    @DefaultHandler
    fun handle() {
        try {
            EssentialAPI.getGuiUtil().openScreen(LevelheadGUI())
        } catch (_: Exception) {
            EssentialAPI.getMinecraftUtil().sendMessage(
                "${ChatColor.AQUA}[Levelhead]", message = "${ChatColor.RED} Failed to open menu. Server might be down. Try restarting your game."
            )
            return
        }
        remindToSetApiKey()
    }

    @SubCommand(value = "limit")
    fun handleLimit() {
        EssentialAPI.getMinecraftUtil()
            .sendMessage("${ChatColor.AQUA}[Levelhead]", "${ChatColor.RED}Callback_types: " + types)
        EssentialAPI.getMinecraftUtil().sendMessage(
            "${ChatColor.AQUA}[Levelhead]",
            "${ChatColor.RED}Hypixel: " + EssentialAPI.getMinecraftUtil().isHypixel()
        )
    }

    @SubCommand(value = "reauth")
    fun handleReauth() {
        Levelhead.scope.launch {
            launch {
                Levelhead.refreshRawPurchases()
            }
            launch {
                Levelhead.refreshPaidData()
            }
            launch {
                Levelhead.refreshPurchaseStates()
            }
            launch {
                Levelhead.refreshTypes()
            }
        }.invokeOnCompletion {
            if (it == null)
                EssentialAPI.getMinecraftUtil().sendMessage("${ChatColor.AQUA}[Levelhead]", "${ChatColor.GREEN} Reauthed!")
            else
                EssentialAPI.getMinecraftUtil().sendMessage("${ChatColor.AQUA}[Levelhead]", "${ChatColor.RED} Reauth failed!")
        }
    }

    @SubCommand(value = "dumpcache")
    fun handleDumpCache() {
        Levelhead.scope.coroutineContext.cancelChildren()
        Levelhead.rateLimiter.resetState()
        displayManager.clearCache()
        EssentialAPI.getMinecraftUtil().sendMessage("${ChatColor.AQUA}[Levelhead]", "${ChatColor.GREEN} Cleared Cache")
    }

    @SubCommand(value = "apikey", aliases = ["setapikey"])
    fun handleApiKey(key: String) {
        if (key.equals("clear", ignoreCase = true)) {
            LevelheadConfig.clearApiKey()
            EssentialAPI.getMinecraftUtil().sendMessage("${ChatColor.AQUA}[Levelhead]", "${ChatColor.GREEN} Cleared stored Hypixel API key.")
            return
        }

        val sanitized = key.trim()
        val normalized = sanitized.replace("-", "")
        if (!API_KEY_PATTERN.matches(normalized)) {
            EssentialAPI.getMinecraftUtil().sendMessage(
                "${ChatColor.AQUA}[Levelhead]",
                "${ChatColor.RED}Invalid Hypixel API key. Keys should be 32 hexadecimal characters."
            )
            return
        }

        LevelheadConfig.setApiKey(sanitized)
        EssentialAPI.getMinecraftUtil().sendMessage(
            "${ChatColor.AQUA}[Levelhead]",
            "${ChatColor.GREEN}Saved Hypixel API key for BedWars stat fetching."
        )
        remindedAboutApiKey = true
    }

    @SubCommand(value = "clearapikey")
    fun handleClearApiKey() {
        LevelheadConfig.clearApiKey()
        EssentialAPI.getMinecraftUtil().sendMessage("${ChatColor.AQUA}[Levelhead]", "${ChatColor.GREEN} Cleared stored Hypixel API key.")
        remindedAboutApiKey = false
    }

    @SubCommand(value = "bedwars")
    fun handleBedwarsToggle(state: String) {
        val normalized = state.trim().lowercase(Locale.ROOT)
        val enabled = when (normalized) {
            "on", "enable", "enabled", "true" -> true
            "off", "disable", "disabled", "false" -> false
            else -> {
                EssentialAPI.getMinecraftUtil().sendMessage(
                    "${ChatColor.AQUA}[Levelhead]",
                    "${ChatColor.RED}Usage: /levelhead bedwars <on|off>"
                )
                return
            }
        }

        LevelheadConfig.setBedwarsIntegrationEnabled(enabled)
        EssentialAPI.getMinecraftUtil().sendMessage(
            "${ChatColor.AQUA}[Levelhead]",
            if (enabled) "${ChatColor.GREEN}Enabled BedWars star integration." else "${ChatColor.YELLOW}Disabled BedWars star integration."
        )
    }

    private fun remindToSetApiKey() {
        if (LevelheadConfig.bedwarsIntegrationEnabled && LevelheadConfig.apiKey.isBlank() && !remindedAboutApiKey) {
            remindedAboutApiKey = true
            EssentialAPI.getMinecraftUtil().sendMessage(
                "${ChatColor.AQUA}[Levelhead]",
                "${ChatColor.YELLOW}Set your Hypixel API key with ${ChatColor.GOLD}/levelhead apikey <key>${ChatColor.YELLOW} to enable BedWars stats."
            )
        }
    }
}
