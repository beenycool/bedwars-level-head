package club.sk1er.mods.levelhead.commands

import net.minecraft.client.Minecraft
import net.minecraft.event.ClickEvent
import net.minecraft.event.HoverEvent
import net.minecraft.util.ChatComponentText
import net.minecraft.util.IChatComponent
import net.minecraft.util.EnumChatFormatting as ChatColor

object CommandUtils {
    fun sendPrefixedChat(component: IChatComponent) {
        val minecraft = Minecraft.getMinecraft()
        val formatted = ChatComponentText("${ChatColor.AQUA}[Levelhead] ${ChatColor.RESET}")
        formatted.appendSibling(component)
        minecraft.addScheduledTask {
            minecraft.thePlayer?.addChatMessage(formatted)
        }
    }

    fun createClickableCommand(command: String, run: Boolean = false, suggestedCommand: String = command): IChatComponent {
        val action = if (run) ClickEvent.Action.RUN_COMMAND else ClickEvent.Action.SUGGEST_COMMAND
        val hoverText = if (run) "${ChatColor.GREEN}Click to run" else "${ChatColor.GREEN}Click to fill"

        return ChatComponentText("${ChatColor.GOLD}$command").apply {
            chatStyle.chatClickEvent = ClickEvent(action, suggestedCommand)
            chatStyle.chatHoverEvent = HoverEvent(HoverEvent.Action.SHOW_TEXT, ChatComponentText(hoverText))
        }
    }
}
