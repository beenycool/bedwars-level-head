package club.sk1er.mods.levelhead.commands

import club.sk1er.mods.levelhead.Levelhead
import club.sk1er.mods.levelhead.bedwars.BedwarsFetcher
import club.sk1er.mods.levelhead.config.LevelheadConfig
import gg.essential.api.EssentialAPI
import gg.essential.api.commands.Command
import gg.essential.api.commands.DefaultHandler
import gg.essential.api.commands.SubCommand
import gg.essential.universal.ChatColor
import kotlinx.coroutines.cancelChildren

class LevelheadCommand : Command("levelhead") {

    companion object {
        private val API_KEY_PATTERN = Regex("^[a-f0-9]{32}$", RegexOption.IGNORE_CASE)
    }

    @DefaultHandler
    fun handle() {
        EssentialAPI.getMinecraftUtil().sendMessage(
            "${ChatColor.AQUA}[Levelhead]",
            "${ChatColor.YELLOW}BedWars star display is active. Use ${ChatColor.GOLD}/levelhead apikey <key>${ChatColor.YELLOW} to set your Hypixel API key."
        )
    }

    @SubCommand(value = "apikey", aliases = ["setapikey"])
    fun handleApiKey(key: String) {
        if (key.equals("clear", ignoreCase = true)) {
            LevelheadConfig.clearApiKey()
            EssentialAPI.getMinecraftUtil().sendMessage(
                "${ChatColor.AQUA}[Levelhead]",
                "${ChatColor.GREEN}Cleared stored Hypixel API key."
            )
            resetBedwarsFetcher()
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
        resetBedwarsFetcher()
    }

    @SubCommand(value = "clearapikey")
    fun handleClearApiKey() {
        LevelheadConfig.clearApiKey()
        EssentialAPI.getMinecraftUtil().sendMessage(
            "${ChatColor.AQUA}[Levelhead]",
            "${ChatColor.GREEN}Cleared stored Hypixel API key."
        )
        resetBedwarsFetcher()
    }

    @SubCommand(value = "reload")
    fun handleReload() {
        Levelhead.scope.coroutineContext.cancelChildren()
        Levelhead.rateLimiter.resetState()
        Levelhead.displayManager.clearCache()
        EssentialAPI.getMinecraftUtil().sendMessage(
            "${ChatColor.AQUA}[Levelhead]",
            "${ChatColor.GREEN}Reloaded BedWars star cache."
        )
    }

    private fun resetBedwarsFetcher() {
        Levelhead.scope.coroutineContext.cancelChildren()
        Levelhead.rateLimiter.resetState()
        Levelhead.displayManager.clearCachesWithoutRefetch()
        BedwarsFetcher.resetWarnings()
    }
}
