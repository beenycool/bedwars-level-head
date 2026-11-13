package club.sk1er.mods.levelhead.mixin;

import club.sk1er.mods.levelhead.core.DebugLogging;
import club.sk1er.mods.levelhead.render.TabRender;
import net.minecraft.client.gui.GuiPlayerTabOverlay;
import net.minecraft.client.network.NetworkPlayerInfo;
import net.minecraft.scoreboard.ScoreObjective;
import net.minecraft.scoreboard.Scoreboard;
import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/**
 * Renders Levelhead stats inside the vanilla tab list.
 *
 * Every hook here is a plain {@link Inject}: none of them are exclusive, so another
 * mod hooking the same method (Patcher, VanillaEnhancements, other tab mods) can no
 * longer fail this mixin (B28). The old {@code @Redirect(require = 1)} on
 * {@code getPlayerName} and the MixinExtras {@code @WrapOperation} on {@code drawPing}
 * are gone.
 *
 * {@code TabRender} is called directly - the reflective {@code TabRenderBridge} was
 * deleted (B16). An exception escaping into the render loop is caught and logged once
 * per hook at ERROR; it used to be swallowed for every frame.
 */
@Mixin(GuiPlayerTabOverlay.class)
public class MixinGuiPlayerTabOverlay {

    /**
     * Holder rather than a plain static field: the mixin class is loaded very early
     * during launch, and log4j should not be touched at that point.
     */
    private static final class Log {
        static final Logger INSTANCE = LogManager.getLogger("Levelhead/TabMixin");
    }

    /** One flag per hook so a per-frame failure logs once instead of 60 times a second. */
    private static boolean loggedBeginFrame;
    private static boolean loggedEndFrame;
    private static boolean loggedPadding;
    private static boolean loggedDraw;

    @Inject(method = "renderPlayerlist", at = @At("HEAD"))
    private void levelhead$beginFrame(int width, Scoreboard scoreboard, ScoreObjective objective, CallbackInfo ci) {
        try {
            TabRender.beginFrame(objective);
            if (DebugLogging.INSTANCE.isRenderDebugEnabled()) {
                DebugLogging.INSTANCE.logTabDebug("[LevelheadDebug][tab][mixin] renderPlayerlist HEAD fired");
            }
        } catch (Throwable throwable) {
            if (!loggedBeginFrame) {
                loggedBeginFrame = true;
                Log.INSTANCE.error("Levelhead: building tab frame state failed; tab stats disabled for this frame", throwable);
            }
        }
    }

    @Inject(method = "renderPlayerlist", at = @At("RETURN"))
    private void levelhead$endFrame(int width, Scoreboard scoreboard, ScoreObjective objective, CallbackInfo ci) {
        try {
            TabRender.endFrame();
            if (DebugLogging.INSTANCE.isRenderDebugEnabled()) {
                DebugLogging.INSTANCE.logTabDebug("[LevelheadDebug][tab][mixin] renderPlayerlist RETURN fired");
            }
        } catch (Throwable throwable) {
            if (!loggedEndFrame) {
                loggedEndFrame = true;
                Log.INSTANCE.error("Levelhead: releasing tab frame state failed", throwable);
            }
        }
    }

    /**
     * Widen each row by padding the measured name with trailing spaces so the stats
     * text drawn in {@link #levelhead$drawTabStats} has room.
     *
     * Vanilla measures the row width with {@code getPlayerName} (called twice per row:
     * once for the column width, once for the drawn string). Appending spaces to the
     * result widens the column without redirecting the call, so it does not conflict
     * with other mods.
     */
    @Inject(method = "getPlayerName", at = @At("RETURN"), cancellable = true)
    private void levelhead$padMeasuredName(NetworkPlayerInfo info, CallbackInfoReturnable<String> cir) {
        try {
            String original = cir.getReturnValue();
            if (original == null) {
                return;
            }
            String padded = TabRender.getMeasuredName(original, info);
            if (padded != null && !padded.equals(original)) {
                cir.setReturnValue(padded);
                if (DebugLogging.INSTANCE.isRenderDebugEnabled()) {
                    DebugLogging.INSTANCE.logTabDebug(
                        "[LevelheadDebug][tab][mixin] padMeasuredName for " + info.getGameProfile().getName()
                    );
                }
            }
        } catch (Throwable throwable) {
            if (!loggedPadding) {
                loggedPadding = true;
                Log.INSTANCE.error("Levelhead: measuring tab entry width failed; tab stats may overlap", throwable);
            }
        }
    }

    /**
     * Draw the stats text just before the ping icon is painted. {@code drawPing} already
     * receives the row geometry (column width, x, y) and the entry, so a HEAD injection
     * needs no local capture and no {@code @Redirect} on the call site.
     */
    @Inject(method = "drawPing", at = @At("HEAD"))
    private void levelhead$drawTabStats(int offset, int x, int y, NetworkPlayerInfo info, CallbackInfo ci) {
        try {
            TabRender.drawPrepared(offset, x, y, info);
            if (DebugLogging.INSTANCE.isRenderDebugEnabled()) {
                DebugLogging.INSTANCE.logTabDebug(
                    "[LevelheadDebug][tab][mixin] drawPing for " + info.getGameProfile().getName()
                );
            }
        } catch (Throwable throwable) {
            if (!loggedDraw) {
                loggedDraw = true;
                Log.INSTANCE.error("Levelhead: drawing tab stats failed; tab stats disabled", throwable);
            }
        }
    }
}
