package me.truffle.bedwarslevelhead.events

import me.truffle.bedwarslevelhead.BedwarsLevelHead
import me.truffle.bedwarslevelhead.data.LevelCache
import me.truffle.bedwarslevelhead.utils.ChatUtils
import net.minecraftforge.client.event.ClientChatReceivedEvent
import net.minecraftforge.fml.common.eventhandler.SubscribeEvent
import net.minecraftforge.fml.common.gameevent.TickEvent

object EventSubscriber {

    @SubscribeEvent
    fun onChatReceived(event: ClientChatReceivedEvent) {
        if (!BedwarsLevelHead.config.enabled || !BedwarsLevelHead.config.chatDetection) return

        val message = event.message.unformattedText
        ChatUtils.detectLevelFromChat(message)
    }

    @SubscribeEvent
    fun onClientTick(event: TickEvent.ClientTickEvent) {
        if (event.phase != TickEvent.Phase.END) return
        if (!BedwarsLevelHead.config.enabled) return

        // Periodic cache cleanup
        if (event.clientTickCount % 600 == 0) { // Every 30 seconds
            // Cleanup is handled in getPlayerLevel
        }
    }
}