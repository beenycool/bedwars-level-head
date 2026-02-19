package club.sk1er.mods.levelhead.mixin;

import club.sk1er.mods.levelhead.render.TabRender;
import net.minecraft.client.gui.GuiPlayerTabOverlay;
import net.minecraft.client.network.NetworkPlayerInfo;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Unique;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.ModifyArg;
import org.spongepowered.asm.mixin.injection.ModifyVariable;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/**
 * Mixin for {@link GuiPlayerTabOverlay} to render Levelhead stats in the tab list.
 */
@Mixin(GuiPlayerTabOverlay.class)
public class MixinGuiPlayerTabOverlay {

    @Unique
    private NetworkPlayerInfo levelhead$currentPlayerInfo;

    /**
     * Captures the NetworkPlayerInfo during tab list rendering.
     * Note: ordinal = 9 targets the STORE instruction for the player info variable
     * used in the main render loop iteration. This captures each player's info
     * as the tab list iterates through players for rendering.
     */
    @ModifyVariable(method = "renderPlayerlist", at = @At("STORE"), ordinal = 9)
    private NetworkPlayerInfo levelhead$capturePlayerInfo(NetworkPlayerInfo info) {
        this.levelhead$currentPlayerInfo = info;
        return info;
    }

    /**
     * Widens the name column in the tab list to accommodate Levelhead stats.
     * Uses ceiling division to ensure sufficient space is allocated.
     */
    @ModifyArg(
        method = "renderPlayerlist",
        at = @At(value = "INVOKE", target = "Lnet/minecraft/client/gui/FontRenderer;getStringWidth(Ljava/lang/String;)I")
    )
    private String levelhead$widenColumn(String original) {
        if (this.levelhead$currentPlayerInfo == null) return original;
        int extraWidth = TabRender.getLevelheadWidth(this.levelhead$currentPlayerInfo);
        if (extraWidth <= 0) return original;
        int spaceWidth = net.minecraft.client.Minecraft.getMinecraft().fontRendererObj.getCharWidth(' ');
        if (spaceWidth <= 0) return original;
        // Use ceiling division to avoid under-allocating pixels
        int spaces = (extraWidth + spaceWidth - 1) / spaceWidth;
        StringBuilder sb = new StringBuilder(original);
        for (int i = 0; i < spaces; i++) {
            sb.append(' ');
        }
        return sb.toString();
    }

    @Inject(method = "drawPing", at = @At("HEAD"))
    private void levelhead$drawPingHook(int offset, int x, int y, NetworkPlayerInfo networkPlayerInfo, CallbackInfo ci) {
        TabRender.drawPingHook(offset, x, y, networkPlayerInfo);
    }
}
