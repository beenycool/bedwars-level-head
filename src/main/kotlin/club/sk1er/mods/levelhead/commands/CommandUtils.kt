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
        val formatted = ChatComponentText("")
            .appendSibling(ChatComponentText("${ChatColor.AQUA}[Levelhead]").apply {
                chatStyle.chatClickEvent = ClickEvent(ClickEvent.Action.RUN_COMMAND, "/levelhead gui")
                chatStyle.chatHoverEvent = HoverEvent(HoverEvent.Action.SHOW_TEXT, ChatComponentText("${ChatColor.GREEN}Click to open settings GUI"))
            })
            .appendSibling(ChatComponentText(" ${ChatColor.RESET}"))
            .appendSibling(component)
        minecraft.addScheduledTask {
            minecraft.thePlayer?.addChatMessage(formatted)
        }
    }

    fun createClickableCommand(
        command: String,
        run: Boolean = false,
        suggestedCommand: String = command,
        displayText: String? = null,
        hoverTextOverride: String? = null
    ): IChatComponent {
        val action = if (run) ClickEvent.Action.RUN_COMMAND else ClickEvent.Action.SUGGEST_COMMAND
        val hoverText = hoverTextOverride ?: "${ChatColor.GREEN}Click to ${if (run) "run" else "fill"} command"
        val text = displayText ?: "${ChatColor.GOLD}$command"

        return ChatComponentText(text).apply {
            chatStyle.chatClickEvent = ClickEvent(action, suggestedCommand)
            chatStyle.chatHoverEvent = HoverEvent(HoverEvent.Action.SHOW_TEXT, ChatComponentText(hoverText))
        }
    }

    fun createClickableUrl(url: String, text: String = url): IChatComponent {
        return ChatComponentText(text).apply {
            chatStyle.chatClickEvent = ClickEvent(ClickEvent.Action.OPEN_URL, url)
            chatStyle.chatHoverEvent = HoverEvent(HoverEvent.Action.SHOW_TEXT, ChatComponentText("${ChatColor.GREEN}Click to open link"))
        }
    }

    fun buildInteractiveFeedback(
        messagePrefix: String,
        command: String,
        suggestedCommand: String = command,
        run: Boolean = false,
        suffix: String = "",
        hoverTextOverride: String? = null
    ): IChatComponent {
        val component = ChatComponentText(messagePrefix)
        component.appendSibling(createClickableCommand(command, run, suggestedCommand, hoverTextOverride = hoverTextOverride))
        if (suffix.isNotEmpty()) {
            component.appendSibling(ChatComponentText(suffix))
        }
        return component
    }
}
