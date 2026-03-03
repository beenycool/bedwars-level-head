package club.sk1er.mods.levelhead.commands

import net.minecraft.client.Minecraft
import net.minecraft.event.ClickEvent
import net.minecraft.event.HoverEvent
import net.minecraft.util.ChatComponentText
import net.minecraft.util.EnumChatFormatting as ChatColor
import net.minecraft.util.IChatComponent

object ChatUtils {
    fun createClickableCommand(display: String, suggest: String? = null, run: Boolean = false): IChatComponent {
        val command = suggest ?: display
        val action = if (run) ClickEvent.Action.RUN_COMMAND else ClickEvent.Action.SUGGEST_COMMAND
        val hoverText = if (run) "${ChatColor.GREEN}Click to run" else "${ChatColor.GREEN}Click to fill"

        return ChatComponentText("${ChatColor.GOLD}$display").apply {
            chatStyle.setChatClickEvent(ClickEvent(action, command))
            chatStyle.setChatHoverEvent(HoverEvent(HoverEvent.Action.SHOW_TEXT, ChatComponentText(hoverText)))
        }
    }

    fun sendMessage(message: String) {
        val minecraft = Minecraft.getMinecraft()
        val formatted = "${ChatColor.AQUA}[Levelhead] ${ChatColor.RESET}$message"
        minecraft.addScheduledTask {
            minecraft.thePlayer?.addChatMessage(ChatComponentText(formatted))
        }
    }

    fun sendMessage(component: IChatComponent) {
        val minecraft = Minecraft.getMinecraft()
        val formatted = ChatComponentText("${ChatColor.AQUA}[Levelhead] ${ChatColor.RESET}")
        formatted.appendSibling(component)
        minecraft.addScheduledTask {
            minecraft.thePlayer?.addChatMessage(formatted)
        }
    }
}
