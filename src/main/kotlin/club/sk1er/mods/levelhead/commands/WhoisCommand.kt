package club.sk1er.mods.levelhead.commands

import club.sk1er.mods.levelhead.Levelhead
import cc.polyfrost.oneconfig.utils.commands.annotations.Command
import cc.polyfrost.oneconfig.utils.commands.annotations.Greedy
import cc.polyfrost.oneconfig.utils.commands.annotations.Main
import net.minecraft.client.Minecraft
import net.minecraft.util.ChatComponentText
import net.minecraft.util.EnumChatFormatting as ChatColor
import kotlinx.coroutines.launch

/**
 * Standalone /whois command that is an alias for /levelhead whois.
 * Allows users to quickly look up player stats without typing the full command.
 */
@Command(value = "whois")
class WhoisCommand {

    @Main
    fun handle(@Greedy identifier: String = "") {
        val trimmedIdentifier = identifier.trim()
        if (trimmedIdentifier.isEmpty()) {
            sendMessage(
                "${ChatColor.RED}Tell me who to inspect.${ChatColor.YELLOW} Run ${ChatColor.GOLD}/whois <player|uuid>${ChatColor.YELLOW} using an in-game name, UUID, or someone nearby."
            )
            return
        }

        sendMessage("${ChatColor.YELLOW}Looking up stats for ${ChatColor.GOLD}$trimmedIdentifier${ChatColor.YELLOW}...")
        Levelhead.scope.launch {
            try {
                val resultMessage = WhoisService.lookupWhoisMessage(trimmedIdentifier)
                sendMessage(resultMessage)
            } catch (ex: WhoisService.CommandException) {
                sendMessage("${ChatColor.RED}${ex.message}")
            } catch (throwable: Throwable) {
                Levelhead.logger.error("Failed to resolve stats for {}", identifier, throwable)
                sendMessage("${ChatColor.RED}Unexpected error while fetching stats. Check logs for details.")
            }
        }
    }

    private fun sendMessage(message: String) {
        val minecraft = Minecraft.getMinecraft()
        val formatted = "${ChatColor.AQUA}[Levelhead] ${ChatColor.RESET}$message"
        minecraft.addScheduledTask {
            minecraft.thePlayer?.addChatMessage(ChatComponentText(formatted))
        }
    }

}
