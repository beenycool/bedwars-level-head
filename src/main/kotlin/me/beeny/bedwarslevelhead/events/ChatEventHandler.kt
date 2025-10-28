package me.beeny.bedwarslevelhead.events

import me.beeny.bedwarslevelhead.BedwarsLevelHead
import me.beeny.bedwarslevelhead.utils.ChatUtils
import me.beeny.bedwarslevelhead.utils.MinecraftUtils
import net.minecraft.util.ChatComponentText

object ChatEventHandler {

    fun handleChatMessage(message: String) {
        try {
            ChatUtils.detectLevelFromChat(message)
        } catch (t: Throwable) {
			val player = runCatching { MinecraftUtils.getPlayerName() }.getOrNull() ?: ""
			val exceptionName = t::class.java.simpleName
			System.err.println("[BedwarsLevelHead] ${exceptionName} while handling chat for '$player': ${t.message}\nMessage: $message")
			if (BedwarsLevelHead.config.debug) {
				// Print full stack trace in debug to aid troubleshooting
				t.printStackTrace()
				runCatching {
					net.minecraft.client.Minecraft.getMinecraft().thePlayer?.addChatMessage(
						ChatComponentText("§cLevelHead error parsing chat. See logs for details.")
					)
				}
			}
        }
    }
}