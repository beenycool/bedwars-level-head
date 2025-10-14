package club.sk1er.mods.levelhead.mixin;

import net.minecraft.client.gui.GuiPlayerTabOverlay;
import org.spongepowered.asm.mixin.Mixin;

@Mixin(GuiPlayerTabOverlay.class)
public abstract class MixinGuiPlayerTabOverlay {
    // BedWars Levelhead no longer customises the tab list.
}
