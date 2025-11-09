package club.sk1er.mods.levelhead.compat

import org.polyfrost.oneconfig.libs.universal.ChatColor
import org.polyfrost.oneconfig.libs.universal.UMinecraft
import net.minecraft.util.ChatComponentText
import net.minecraft.util.IChatComponent

object ChatUtils {
    fun sendMessage(message: String) {
        val mc = UMinecraft.getMinecraft()
        mc.addScheduledTask {
            mc.thePlayer?.addChatMessage(ChatComponentText(message))
        }
    }
}

object ServerUtils {
    fun isHypixel(): Boolean {
        val mc = UMinecraft.getMinecraft()
        val serverData = mc.currentServerData ?: return false
        return serverData.serverIP?.lowercase()?.contains("hypixel") == true ||
               serverData.serverName?.lowercase()?.contains("hypixel") == true
    }
}

object CommandManager {
    fun registerCommand(command: Any) {
        // Commands will be registered via Forge's command system
        // This is a placeholder for OneConfig command registration
    }
}
