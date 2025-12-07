package club.sk1er.mods.levelhead.render

import club.sk1er.mods.levelhead.Levelhead
import club.sk1er.mods.levelhead.Levelhead.displayManager
import club.sk1er.mods.levelhead.display.LevelheadTag
import club.sk1er.mods.levelhead.core.BedwarsModeDetector
import net.minecraft.client.Minecraft
import net.minecraft.client.gui.FontRenderer
import net.minecraft.client.renderer.GlStateManager
import net.minecraft.client.renderer.Tessellator
import net.minecraft.client.renderer.vertex.DefaultVertexFormats
import net.minecraft.entity.EntityLivingBase
import net.minecraft.entity.player.EntityPlayer
import net.minecraftforge.client.event.RenderLivingEvent
import net.minecraftforge.fml.common.eventhandler.SubscribeEvent
import org.lwjgl.opengl.GL11
import java.awt.Color

object AboveHeadRender {

    private var frameCounter = 0

    @SubscribeEvent
    fun render(event: RenderLivingEvent.Specials.Post<EntityLivingBase>) {
        if (!displayManager.config.enabled) return
        if (!Levelhead.isOnHypixel()) return
        val minecraft = Minecraft.getMinecraft()
        if (minecraft.gameSettings.hideGUI) return
        if (!BedwarsModeDetector.shouldRenderTags()) return

        val skip = displayManager.config.frameSkip.coerceAtLeast(1)
        frameCounter = (frameCounter + 1) % skip
        if (frameCounter != 0) return

        val player = event.entity as? EntityPlayer ?: return
        val localPlayer = minecraft.thePlayer

        displayManager.aboveHead.forEachIndexed { index, display ->
            if (!display.config.enabled || (player.isSelf() && !display.config.showSelf)) return@forEachIndexed
            val tag = display.cache[player.uniqueID] ?: return@forEachIndexed
            if (!display.loadOrRender(player)) return@forEachIndexed

            var offset = 0.3
            val hasScoreboardObjective = player.worldScoreboard?.getObjectiveInDisplaySlot(2) != null
            val isCloseToLocalPlayer = localPlayer?.let { player.getDistanceSqToEntity(it) < 100 } ?: false
            if (hasScoreboardObjective && isCloseToLocalPlayer) {
                offset *= 2
            }
            if (player.isSelf()) {
                offset = 0.0
            }
            // Shift tag down when player is sneaking (like vanilla nametags)
            if (player.isSneaking) {
                offset -= 0.25
            }
            offset += displayManager.config.offset
            renderName(tag, player, event.x, event.y + offset + index * 0.3, event.z)
        }
    }

    private fun EntityPlayer.isSelf(): Boolean {
        val local = Minecraft.getMinecraft().thePlayer ?: return false
        return local.uniqueID == this.uniqueID
    }

    private fun renderName(tag: LevelheadTag, entity: EntityPlayer, x: Double, y: Double, z: Double) {
        val mc = Minecraft.getMinecraft()
        val renderer = mc.fontRendererObj
        val scale = (0.016666668f * 1.6f * displayManager.config.fontSize).toFloat()
        GlStateManager.pushMatrix()
        GlStateManager.translate(x.toFloat(), (y + entity.height + 0.5).toFloat(), z.toFloat())
        GL11.glNormal3f(0.0f, 1.0f, 0.0f)
        val view = mc.renderManager
        val xMultiplier = if (mc.gameSettings.thirdPersonView == 2) -1 else 1
        GlStateManager.rotate(-view.playerViewY, 0.0f, 1.0f, 0.0f)
        GlStateManager.rotate(view.playerViewX * xMultiplier, 1.0f, 0.0f, 0.0f)
        GlStateManager.scale(-scale, -scale, scale)
        GlStateManager.disableLighting()
        GlStateManager.depthMask(false)
        GlStateManager.disableDepth()
        GlStateManager.enableBlend()
        GlStateManager.tryBlendFuncSeparate(GL11.GL_SRC_ALPHA, GL11.GL_ONE_MINUS_SRC_ALPHA, GL11.GL_ONE, GL11.GL_ZERO)

        val halfWidth = renderer.getStringWidth(tag.getString()) / 2
        val headerWidth = tag.header.getWidth(renderer)
        drawBackground(halfWidth)
        renderString(renderer, tag, halfWidth, headerWidth)

        GlStateManager.enableLighting()
        GlStateManager.disableBlend()
        GlStateManager.color(1f, 1f, 1f, 1f)
        GlStateManager.depthMask(true)
        GlStateManager.enableDepth()
        GlStateManager.popMatrix()
    }

    private fun drawBackground(halfWidth: Int) {
        if (!displayManager.config.showBackground) return
        val alpha = displayManager.config.backgroundOpacity.coerceIn(0f, 100f) / 100f
        val tessellator = Tessellator.getInstance()
        val buffer = tessellator.worldRenderer
        buffer.begin(GL11.GL_QUADS, DefaultVertexFormats.POSITION_COLOR)
        val left = -halfWidth - 2.0
        val right = halfWidth + 1.0
        buffer.pos(left, -1.0, 0.0).color(0f, 0f, 0f, alpha).endVertex()
        buffer.pos(left, 8.0, 0.0).color(0f, 0f, 0f, alpha).endVertex()
        buffer.pos(right, 8.0, 0.0).color(0f, 0f, 0f, alpha).endVertex()
        buffer.pos(right, -1.0, 0.0).color(0f, 0f, 0f, alpha).endVertex()
        tessellator.draw()
    }

    private fun renderString(renderer: FontRenderer, tag: LevelheadTag, halfWidth: Int, headerWidth: Int) {
        var x = -halfWidth
        renderComponent(renderer, tag.header, x)
        x += headerWidth
        renderComponent(renderer, tag.footer, x)
    }

    private fun renderComponent(renderer: FontRenderer, component: LevelheadTag.LevelheadComponent, x: Int) {
        if (displayManager.config.textShadow) {
            GlStateManager.disableDepth()
            GlStateManager.depthMask(false)
            // Shadow (faded)
            renderer.drawString(component.value, x, 0, component.color.withAlphaFactor(0.2f))
            GlStateManager.enableDepth()
            GlStateManager.depthMask(true)
        }
        // Main text
        renderer.drawString(component.value, x, 0, component.color.rgb)
    }

    private fun Color.withAlphaFactor(alpha: Float): Int {
        val clamped = alpha.coerceIn(0f, 1f)
        val a = (clamped * 255f).toInt().coerceIn(0, 255)
        return Color(red, green, blue, a).rgb
    }

    /**
     * Scheduled cleanup invoked from Levelhead.onClientTick so cleanup doesn't run on render thread.
     * Kept as a no-op for compatibility with older file state.
     */
    fun performScheduledCleanup() {
        // no-op: this version of AboveHeadRender does not maintain a render-time cache
    }
}