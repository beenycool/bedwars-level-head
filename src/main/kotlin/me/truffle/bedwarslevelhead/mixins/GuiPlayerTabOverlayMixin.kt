package me.truffle.bedwarslevelhead.mixins

import me.truffle.bedwarslevelhead.BedwarsLevelHead
import me.truffle.bedwarslevelhead.data.LevelCache
import net.minecraft.client.gui.GuiPlayerTabOverlay
import net.minecraft.util.IChatComponent
import org.spongepowered.asm.mixin.Mixin
import org.spongepowered.asm.mixin.injection.At
import org.spongepowered.asm.mixin.injection.ModifyVariable

@Mixin(GuiPlayerTabOverlay::class)
class GuiPlayerTabOverlayMixin {

    @ModifyVariable(
        method = ["getPlayerName"],
        at = At("HEAD"),
        argsOnly = true
    )
    fun modifyTabListName(displayName: IChatComponent): IChatComponent {
        if (!BedwarsLevelHead.config.enabled || !BedwarsLevelHead.config.tabListEnabled) {
            return displayName
        }

        val playerName = displayName.unformattedText
        val levelData = LevelCache.getPlayerLevel(playerName) ?: return displayName

        val levelText = levelData.getFormattedLevel()
        val modifiedName = "$levelText $playerName"

        return net.minecraft.util.ChatComponentText(modifiedName)
    }
}