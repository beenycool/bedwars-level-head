package me.beeny.bedwarslevelhead.mixins

import me.beeny.bedwarslevelhead.BedwarsLevelHead
import me.beeny.bedwarslevelhead.data.LevelCache
import net.minecraft.client.gui.GuiPlayerTabOverlay
import net.minecraft.util.IChatComponent
import org.spongepowered.asm.mixin.Mixin
import org.spongepowered.asm.mixin.injection.At
import org.spongepowered.asm.mixin.injection.ModifyVariable

@Mixin(GuiPlayerTabOverlay::class)
class GuiPlayerTabOverlayMixin {

    @ModifyVariable(
        method = ["getPlayerName", "func_175243_a"],
        at = At("STORE"),
        ordinal = 0
    )
    fun modifyTabListName(displayName: IChatComponent): IChatComponent {
        if (!BedwarsLevelHead.config.modEnabled || !BedwarsLevelHead.config.tabListEnabled) {
            return displayName
        }

        val playerName = displayName.unformattedText
        val levelData = LevelCache.getPlayerLevel(playerName) ?: return displayName

        val levelText = levelData.getFormattedLevel()
        val levelComponent = net.minecraft.util.ChatComponentText("$levelText ")
        levelComponent.appendSibling(displayName)

        return levelComponent
    }
}
