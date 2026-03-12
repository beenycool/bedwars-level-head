package club.sk1er.mods.levelhead.commands

import club.sk1er.mods.levelhead.Levelhead
import cc.polyfrost.oneconfig.utils.commands.annotations.Command
import cc.polyfrost.oneconfig.utils.commands.annotations.Greedy
import cc.polyfrost.oneconfig.utils.commands.annotations.Main
import net.minecraft.client.Minecraft
import net.minecraft.event.ClickEvent
import net.minecraft.event.HoverEvent
import net.minecraft.util.ChatComponentText
import net.minecraft.util.IChatComponent
import net.minecraft.util.EnumChatFormatting as ChatColor
import kotlinx.coroutines.launch
import club.sk1er.mods.levelhead.commands.CommandUtils

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
            val msg = ChatComponentText("${ChatColor.RED}Tell me who to inspect.${ChatColor.YELLOW} Try ")
                .appendSibling(CommandUtils.createClickableCommand("/whois <player|uuid>", run = false, suggestedCommand = "/whois "))
                .appendSibling(ChatComponentText("${ChatColor.YELLOW} using an in-game name, UUID, or someone nearby."))
            sendMessage(msg)
            return
        }

        sendMessage("${ChatColor.YELLOW}Looking up stats for ${ChatColor.GOLD}$trimmedIdentifier${ChatColor.YELLOW}...")
        Levelhead.scope.launch {
            try {
                val resultMessage = WhoisService.lookupWhoisMessage(trimmedIdentifier)
                sendMessage(resultMessage)
            } catch (ex: WhoisService.CommandException) {
                sendMessage(ex.component ?: ChatComponentText("${ChatColor.RED}${ex.message}"))
            } catch (throwable: Throwable) {
                Levelhead.logger.error("Failed to resolve stats for {}", identifier, throwable)
                val errorMsg = CommandUtils.buildInteractiveFeedback(
                    messagePrefix = "${ChatColor.RED}Unexpected error while fetching stats. Try ",
                    command = "/levelhead status",
                    run = true,
                    suffix = "${ChatColor.RED} to check your connection or check logs for details."
                )
                sendMessage(errorMsg)
            }
        }
    }

    private fun sendMessage(message: String) {
        CommandUtils.sendPrefixedChat(ChatComponentText(message))
    }

    private fun sendMessage(component: IChatComponent) {
        CommandUtils.sendPrefixedChat(component)
    }

}
