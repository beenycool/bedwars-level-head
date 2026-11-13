package club.sk1er.mods.levelhead.commands

import club.sk1er.mods.levelhead.Levelhead
import club.sk1er.mods.levelhead.config.LevelheadConfig
import cc.polyfrost.oneconfig.utils.commands.annotations.Command
import cc.polyfrost.oneconfig.utils.commands.annotations.Greedy
import cc.polyfrost.oneconfig.utils.commands.annotations.Main
import cc.polyfrost.oneconfig.utils.commands.annotations.SubCommand
import kotlinx.coroutines.launch
import net.minecraft.client.Minecraft
import net.minecraft.util.EnumChatFormatting as ChatColor

@Command(value = "levelhead", aliases = ["lh"])
class LevelheadCommand {

    /** `/levelhead` opens the settings GUI; the GUI covers every option. */
    @Main
    fun handle() {
        Minecraft.getMinecraft().addScheduledTask {
            LevelheadConfig.openGui()
        }
    }

    @SubCommand
    fun status() {
        val snapshot = Levelhead.statusSnapshot()
        val backend = LevelheadConfig.proxyBaseUrl.ifBlank { "not configured" }
        val lastAttempt = formatAge(snapshot.lastAttemptAgeMillis)
        val lastSuccess = formatAge(snapshot.lastSuccessAgeMillis)
        val rateReset = formatAge(snapshot.rateLimitResetMillis)

        sendMessage("${ChatColor.GREEN}Status snapshot:")
        sendMessage("${ChatColor.YELLOW}Backend: ${ChatColor.GOLD}$backend")
        sendMessage("${ChatColor.YELLOW}Cache size: ${ChatColor.GOLD}${snapshot.cacheSize}")
        sendMessage(
            "${ChatColor.YELLOW}Star cache TTL: ${ChatColor.GOLD}${snapshot.starCacheTtlMinutes}m" +
                " ${ChatColor.GRAY}(cold misses: ${snapshot.cacheMissesCold}, expired refreshes: ${snapshot.cacheMissesExpired})"
        )
        sendMessage("${ChatColor.YELLOW}Last request: ${ChatColor.GOLD}$lastAttempt${ChatColor.YELLOW} ago")
        sendMessage("${ChatColor.YELLOW}Last success: ${ChatColor.GOLD}$lastSuccess${ChatColor.YELLOW} ago")
        sendMessage(
            "${ChatColor.YELLOW}Rate limit: ${ChatColor.GOLD}${snapshot.rateLimitRemaining}${ChatColor.YELLOW} remaining, resets in ${ChatColor.GOLD}$rateReset"
        )
        snapshot.serverCooldownMillis?.let {
            sendMessage("${ChatColor.YELLOW}Server cooldown: ${ChatColor.GOLD}${formatAge(it)}${ChatColor.YELLOW} remaining")
        }
    }

    @SubCommand
    fun reload() {
        Levelhead.resetWorldCoroutines()
        Levelhead.displayManager.clearCache()
        sendMessage("${ChatColor.GREEN}Reloaded stats cache.")
    }

    @SubCommand
    fun whois(@Greedy identifier: String) {
        Levelhead.scope.launch {
            WhoisService.runWhoisCommand(
                identifier = identifier,
                hintCommand = "/levelhead whois <player>",
                hintSuggestion = "/levelhead whois "
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
            hours > 0 -> String.format(java.util.Locale.ROOT, "%dh %dm", hours, minutes)
            minutes > 0 -> String.format(java.util.Locale.ROOT, "%dm %ds", minutes, seconds)
            else -> String.format(java.util.Locale.ROOT, "%ds", seconds)
        }
    }

    private fun sendMessage(message: String) {
        CommandUtils.sendPrefixedChat(net.minecraft.util.ChatComponentText(message))
    }
}
