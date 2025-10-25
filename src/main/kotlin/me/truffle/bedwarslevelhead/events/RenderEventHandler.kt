package me.truffle.bedwarslevelhead.events

import me.truffle.bedwarslevelhead.features.LevelDisplay
import net.minecraft.client.entity.AbstractClientPlayer
import net.minecraftforge.client.event.RenderPlayerEvent

object RenderEventHandler {

    fun renderLevelTags(event: RenderPlayerEvent.Pre) {
        if (!BedwarsLevelHead.config.enabled) return

        val player = event.entityPlayer
        if (player is AbstractClientPlayer) {
            LevelDisplay.renderLevelForPlayer(player, event.x, event.y, event.z)
        }
    }
}