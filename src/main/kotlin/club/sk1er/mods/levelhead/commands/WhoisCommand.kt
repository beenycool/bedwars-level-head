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
import kotlinx.coroutines.CancellationException
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
            val msg = CommandUtils.buildInteractiveFeedback(
                messagePrefix = "${ChatColor.RED}Tell me who to inspect.${ChatColor.YELLOW} Try ",
                command = "/whois <player|uuid>",
                suggestedCommand = "/whois ",
                run = false,
                suffix = "${ChatColor.YELLOW} using an in-game name, UUID, or someone nearby.",
                hoverTextOverride = "${ChatColor.GREEN}Click to fill whois command"
            )
            sendMessage(msg)
            return
        }

        sendMessage("${ChatColor.YELLOW}Looking up stats for ${ChatColor.GOLD}$trimmedIdentifier${ChatColor.YELLOW}...")
        Levelhead.scope.launch {
            try {
                val resultMessage = WhoisService.lookupWhoisComponent(trimmedIdentifier)
                sendMessage(resultMessage)
            } catch (ex: WhoisService.CommandException) {
                sendMessage(ex.component ?: ChatComponentText("${ChatColor.RED}${ex.message}"))
            } catch (throwable: Throwable) {
                if (throwable is CancellationException) throw throwable
                Levelhead.logger.error("Failed to resolve stats for {}", identifier, throwable)
                val errorMsg = CommandUtils.buildInteractiveFeedback(
                    messagePrefix = "${ChatColor.RED}Unexpected error while fetching stats. Try ",
                    command = "/levelhead status",
                    run = true,
                    suffix = "${ChatColor.RED} to check your connection or check logs for details. If this issue persists, please make an issue on GitHub: ",
                    hoverTextOverride = "${ChatColor.GREEN}Click to check proxy status"
                )
                errorMsg.appendSibling(CommandUtils.createClickableUrl("https://github.com/beenycool/bedwars-level-head/issues", "${ChatColor.AQUA}GitHub."))
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
