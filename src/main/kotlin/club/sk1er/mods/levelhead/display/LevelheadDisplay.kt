package club.sk1er.mods.levelhead.display

import club.sk1er.mods.levelhead.config.DisplayConfig
import net.minecraft.entity.player.EntityPlayer

abstract class LevelheadDisplay(val config: DisplayConfig) {
    open fun loadOrRender(player: EntityPlayer?) = !player!!.displayName.formattedText.contains("§k", true)
}
