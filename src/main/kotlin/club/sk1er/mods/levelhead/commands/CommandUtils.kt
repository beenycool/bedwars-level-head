package club.sk1er.mods.levelhead.commands

import net.minecraft.client.Minecraft
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
}
