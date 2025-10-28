package me.beeny.bedwarslevelhead.events

import me.beeny.bedwarslevelhead.BedwarsLevelHead
import me.beeny.bedwarslevelhead.data.LevelCache
import me.beeny.bedwarslevelhead.features.LevelDisplay
import me.beeny.bedwarslevelhead.utils.ChatUtils
import me.beeny.bedwarslevelhead.utils.MinecraftUtils
import net.minecraftforge.client.event.ClientChatReceivedEvent
import net.minecraftforge.client.event.RenderGameOverlayEvent
import net.minecraftforge.fml.common.eventhandler.SubscribeEvent
import net.minecraft.util.ChatComponentText

object EventSubscriber {

    @SubscribeEvent
    fun onChatReceived(event: ClientChatReceivedEvent) {
        if (!BedwarsLevelHead.config.enabled || !BedwarsLevelHead.config.chatDetection) return

        val message = event.message.unformattedText
        try {
            ChatUtils.detectLevelFromChat(message)
        } catch (t: Throwable) {
            val player = runCatching { MinecraftUtils.getPlayerName() }.getOrNull() ?: ""
            System.err.println("[BedwarsLevelHead] Error handling chat message for '$player': ${t.message}\nMessage: $message")
            if (BedwarsLevelHead.config.debug) {
                runCatching {
                    net.minecraft.client.Minecraft.getMinecraft().thePlayer?.addChatMessage(
                        ChatComponentText("§cLevelHead error parsing chat. See logs for details.")
                    )
                }
            }
        }
    }

    @SubscribeEvent
    fun onRenderOverlay(event: RenderGameOverlayEvent.Text) {
        if (!BedwarsLevelHead.config.enabled || !BedwarsLevelHead.config.hudEnabled) return
        val playerName = runCatching { MinecraftUtils.getPlayerName() }.getOrNull()
        if (playerName.isNullOrEmpty()) return
        val data = LevelCache.getPlayerLevel(playerName) ?: return
        val text = me.beeny.bedwarslevelhead.features.LevelDisplay.formatLevelText(data.level)
        LevelDisplay.renderHudOverlay(text)
    }

}