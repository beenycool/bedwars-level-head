package club.sk1er.mods.levelhead.commands

import club.sk1er.mods.levelhead.Levelhead
import club.sk1er.mods.levelhead.bedwars.BedwarsFetcher
import club.sk1er.mods.levelhead.config.LevelheadConfig
import club.sk1er.mods.levelhead.gui.LevelheadToggleScreen
import gg.essential.api.EssentialAPI
import gg.essential.api.commands.Command
import gg.essential.api.commands.DefaultHandler
import gg.essential.api.commands.SubCommand
import gg.essential.universal.ChatColor
import gg.essential.universal.UMinecraft
import java.util.Locale

class LevelheadCommand : Command("levelhead") {

    companion object {
        private val API_KEY_PATTERN = Regex("^[a-f0-9]{32}$", RegexOption.IGNORE_CASE)
    }

    @DefaultHandler
    fun handle() {
        EssentialAPI.getMinecraftUtil().sendMessage(
            "${ChatColor.AQUA}[Levelhead]",
            "${ChatColor.YELLOW}BedWars star display is active. Use ${ChatColor.GOLD}/levelhead gui${ChatColor.YELLOW} to open the toggle menu or ${ChatColor.GOLD}/levelhead apikey <key>${ChatColor.YELLOW} to set your Hypixel API key."
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

    @SubCommand(value = "enable")
    fun handleEnable() {
        updateEnabledState(true)
    }

    @SubCommand(value = "disable")
    fun handleDisable() {
        updateEnabledState(false)
    }

    @SubCommand(value = "toggle")
    fun handleToggle() {
        updateEnabledState(!Levelhead.displayManager.config.enabled)
    }

    @SubCommand(value = "gui")
    fun handleGui() {
        UMinecraft.getMinecraft().displayGuiScreen(LevelheadToggleScreen())
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
        val serverCooldown = snapshot.serverCooldownMillis?.let { formatAge(it) }

        sendStatus("${ChatColor.GREEN}Status snapshot:")
        sendStatus("${ChatColor.YELLOW}Proxy: $proxyStatus")
        sendStatus("${ChatColor.YELLOW}Cache size: ${ChatColor.GOLD}${snapshot.cacheSize}")
        sendStatus(
            "${ChatColor.YELLOW}Star cache TTL: ${ChatColor.GOLD}${snapshot.starCacheTtlMinutes}m" +
                "${ChatColor.YELLOW} (cold misses: ${ChatColor.GOLD}${snapshot.cacheMissesCold}${ChatColor.YELLOW}," +
                " expired refreshes: ${ChatColor.GOLD}${snapshot.cacheMissesExpired}${ChatColor.YELLOW})"
        )
        sendStatus("${ChatColor.YELLOW}Last request: ${ChatColor.GOLD}$lastAttempt${ChatColor.YELLOW} ago")
        sendStatus("${ChatColor.YELLOW}Last success: ${ChatColor.GOLD}$lastSuccess${ChatColor.YELLOW} ago")
        sendStatus(
            "${ChatColor.YELLOW}Rate limit: ${ChatColor.GOLD}${snapshot.rateLimitRemaining}${ChatColor.YELLOW} remaining, resets in ${ChatColor.GOLD}$rateReset"
        )
        serverCooldown?.let {
            sendStatus("${ChatColor.YELLOW}Server cooldown hint: ${ChatColor.GOLD}$it${ChatColor.YELLOW} remaining")
        }
    }

    @SubCommand(value = "cachettl")
    fun handleCacheTtl(minutesInput: String) {
        val sanitized = minutesInput.trim()
        val parsed = sanitized.toIntOrNull()
        if (parsed == null) {
            EssentialAPI.getMinecraftUtil().sendMessage(
                "${ChatColor.AQUA}[Levelhead]",
                "${ChatColor.RED}Invalid TTL. Provide the number of minutes between ${LevelheadConfig.MIN_STAR_CACHE_TTL_MINUTES} and ${LevelheadConfig.MAX_STAR_CACHE_TTL_MINUTES}."
            )
            return
        }

        val clamped = parsed.coerceIn(LevelheadConfig.MIN_STAR_CACHE_TTL_MINUTES, LevelheadConfig.MAX_STAR_CACHE_TTL_MINUTES)
        LevelheadConfig.setStarCacheTtlMinutes(clamped)
        Levelhead.clearCachedStars()
        EssentialAPI.getMinecraftUtil().sendMessage(
            "${ChatColor.AQUA}[Levelhead]",
            "${ChatColor.GREEN}Updated BedWars star cache TTL to ${ChatColor.GOLD}${clamped} minutes${ChatColor.GREEN}."
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

    private fun updateEnabledState(enabled: Boolean) {
        val changed = Levelhead.displayManager.setEnabled(enabled)
        val stateText = if (enabled) "enabled" else "disabled"
        val color = if (enabled) ChatColor.GREEN else ChatColor.RED
        if (changed) {
            EssentialAPI.getMinecraftUtil().sendMessage(
                "${ChatColor.AQUA}[Levelhead]",
                "${color}BedWars Levelhead ${ChatColor.YELLOW}has been ${color}$stateText${ChatColor.YELLOW}."
            )
        } else {
            EssentialAPI.getMinecraftUtil().sendMessage(
                "${ChatColor.AQUA}[Levelhead]",
                "${ChatColor.YELLOW}BedWars Levelhead is already ${color}$stateText${ChatColor.YELLOW}."
            )
        }
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
