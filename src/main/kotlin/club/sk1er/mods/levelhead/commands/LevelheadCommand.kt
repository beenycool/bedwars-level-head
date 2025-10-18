package club.sk1er.mods.levelhead.commands

import club.sk1er.mods.levelhead.Levelhead
import club.sk1er.mods.levelhead.bedwars.BedwarsFetcher
import club.sk1er.mods.levelhead.config.LevelheadConfig
import gg.essential.api.EssentialAPI
import gg.essential.api.commands.Command
import gg.essential.api.commands.DefaultHandler
import gg.essential.api.commands.SubCommand
import gg.essential.universal.ChatColor
import java.util.Locale

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
        Levelhead.resetWorldCoroutines()
        Levelhead.rateLimiter.resetState()
        Levelhead.displayManager.clearCache()
        EssentialAPI.getMinecraftUtil().sendMessage(
            "${ChatColor.AQUA}[Levelhead]",
            "${ChatColor.GREEN}Reloaded BedWars star cache."
        )
    }

    @SubCommand(value = "status")
    fun handleStatus() {
        val snapshot = Levelhead.statusSnapshot()
        val proxyStatus = when {
            !snapshot.proxyEnabled -> "${ChatColor.GRAY}disabled"
            snapshot.proxyConfigured -> "${ChatColor.GREEN}configured"
            else -> "${ChatColor.RED}missing config"
        }
        val lastAttempt = formatAge(snapshot.lastAttemptAgeMillis)
        val lastSuccess = formatAge(snapshot.lastSuccessAgeMillis)
        val rateReset = formatAge(snapshot.rateLimitResetMillis)

        sendStatus("${ChatColor.GREEN}Status snapshot:")
        sendStatus("${ChatColor.YELLOW}Proxy: $proxyStatus")
        sendStatus("${ChatColor.YELLOW}Cache size: ${ChatColor.GOLD}${snapshot.cacheSize}")
        sendStatus("${ChatColor.YELLOW}Last request: ${ChatColor.GOLD}$lastAttempt${ChatColor.YELLOW} ago")
        sendStatus("${ChatColor.YELLOW}Last success: ${ChatColor.GOLD}$lastSuccess${ChatColor.YELLOW} ago")
        sendStatus(
            "${ChatColor.YELLOW}Rate limit: ${ChatColor.GOLD}${snapshot.rateLimitRemaining}${ChatColor.YELLOW} remaining, resets in ${ChatColor.GOLD}$rateReset"
        )
    }

    private fun resetBedwarsFetcher() {
        Levelhead.resetWorldCoroutines()
        Levelhead.rateLimiter.resetState()
        Levelhead.displayManager.clearCachesWithoutRefetch()
        BedwarsFetcher.resetWarnings()
    }

    private fun sendStatus(message: String) {
        EssentialAPI.getMinecraftUtil().sendMessage("${ChatColor.AQUA}[Levelhead]", message)
    }

    private fun formatAge(ageMillis: Long?): String {
        ageMillis ?: return "never"
        val totalSeconds = (ageMillis / 1000).coerceAtLeast(0)
        val seconds = (totalSeconds % 60).toInt()
        val minutesTotal = totalSeconds / 60
        val minutes = (minutesTotal % 60).toInt()
        val hours = (minutesTotal / 60).toInt()
        return when {
            hours > 0 -> String.format(Locale.ROOT, "%dh %dm", hours, minutes)
            minutes > 0 -> String.format(Locale.ROOT, "%dm %ds", minutes, seconds)
            else -> String.format(Locale.ROOT, "%ds", seconds)
        }
    }
}
