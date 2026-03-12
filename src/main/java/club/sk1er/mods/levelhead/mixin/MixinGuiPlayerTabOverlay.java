package club.sk1er.mods.levelhead.mixin;

import club.sk1er.mods.levelhead.render.TabRender;
import net.minecraft.client.gui.GuiPlayerTabOverlay;
import net.minecraft.client.network.NetworkPlayerInfo;
import net.minecraft.scoreboard.ScoreObjective;
import net.minecraft.scoreboard.Scoreboard;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.Redirect;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/**
 * Mixin for {@link GuiPlayerTabOverlay} to render Levelhead stats in the tab list.
 *
 * <p>Uses a per-frame approach: stats are resolved once at the start of
 * {@code renderPlayerlist}, column widths are padded via a {@code getPlayerName}
 * redirect, and the prepared text is drawn alongside the ping icon.</p>
 */
@Mixin(GuiPlayerTabOverlay.class)
public class MixinGuiPlayerTabOverlay {

    /**
     * Prepares per-frame tab state at the start of renderPlayerlist.
     * Pre-resolves all player tab strings so per-player hooks only do lookups.
     */
    @Inject(method = "renderPlayerlist", at = @At("HEAD"))
    private void levelhead$beginFrame(int width, Scoreboard scoreboard, ScoreObjective objective, CallbackInfo ci) {
        TabRender.beginFrame(objective);
    }

    /**
     * Clears per-frame tab state at the end of renderPlayerlist.
     */
    @Inject(method = "renderPlayerlist", at = @At("RETURN"))
    private void levelhead$endFrame(int width, Scoreboard scoreboard, ScoreObjective objective, CallbackInfo ci) {
        TabRender.endFrame();
    }

    /**
     * Widens the name column by padding the measured player name string with spaces.
     * Redirects the getPlayerName call used for column width measurement (ordinal 0).
     *
     * <p>In 1.8.9 renderPlayerlist, getPlayerName is called twice per player:
     * ordinal 0 for width measurement, ordinal 1 for rendering. We redirect
     * ordinal 0 to add padding spaces that allocate room for our stats text.</p>
     */
    @Redirect(
        method = "renderPlayerlist",
        at = @At(
            value = "INVOKE",
            target = "Lnet/minecraft/client/gui/GuiPlayerTabOverlay;getPlayerName(Lnet/minecraft/client/network/NetworkPlayerInfo;)Ljava/lang/String;",
            ordinal = 0
        ),
        require = 1
    )
    private String levelhead$padMeasuredName(GuiPlayerTabOverlay overlay, NetworkPlayerInfo info) {
        String original = overlay.getPlayerName(info);
        return TabRender.getMeasuredName(original, info);
    }

    /**
     * Draws the prepared tab stats text next to the player's ping icon.
     */
    @Inject(method = "drawPing", at = @At("HEAD"))
    private void levelhead$drawPingHook(int offset, int x, int y, NetworkPlayerInfo info, CallbackInfo ci) {
        TabRender.drawPrepared(offset, x, y, info);
    }
}
