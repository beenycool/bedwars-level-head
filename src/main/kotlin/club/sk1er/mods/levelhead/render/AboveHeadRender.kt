package club.sk1er.mods.levelhead.render

import club.sk1er.mods.levelhead.Levelhead
import club.sk1er.mods.levelhead.Levelhead.displayManager
import club.sk1er.mods.levelhead.core.BedwarsModeDetector
import club.sk1er.mods.levelhead.display.LevelheadTag
import gg.essential.elementa.utils.withAlpha
import gg.essential.universal.UGraphics
import gg.essential.universal.UMatrixStack
import net.minecraft.client.Minecraft
import net.minecraft.client.gui.FontRenderer
import net.minecraft.client.renderer.GlStateManager
import net.minecraft.client.renderer.vertex.DefaultVertexFormats
import net.minecraft.entity.EntityLivingBase
import net.minecraft.entity.player.EntityPlayer
import net.minecraftforge.client.event.RenderLivingEvent
import net.minecraftforge.fml.common.eventhandler.SubscribeEvent
import org.lwjgl.opengl.GL11
import java.awt.Color

object AboveHeadRender {

    private var frameCounter = 0

    // Copied from original Levelhead constants
    private val DarkChromaColor: Int
        get() = Color.HSBtoRGB(System.currentTimeMillis() % 1000 / 1000f, 0.8f, 0.2f)
    private val ChromaColor: Int
        get() = Color.HSBtoRGB(System.currentTimeMillis() % 1000 / 1000f, 0.8f, 0.8f)

    @SubscribeEvent
    fun render(event: RenderLivingEvent.Specials.Post<EntityLivingBase>) {
        if (!displayManager.config.enabled) return
        if (!Levelhead.isOnHypixel()) return
        
        val minecraft = Minecraft.getMinecraft()
        if (minecraft.gameSettings.hideGUI) return
        if (!BedwarsModeDetector.shouldRenderTags()) return

        // Performance: Frame skipping
        val skip = displayManager.config.frameSkip.coerceAtLeast(1)
        frameCounter = (frameCounter + 1) % skip
        if (frameCounter != 0) return

        val player = event.entity as? EntityPlayer ?: return
        val localPlayer = minecraft.thePlayer ?: return

        displayManager.aboveHead.forEachIndexed { index, display ->
            if (!display.config.enabled || (player.uniqueID == localPlayer.uniqueID && !display.config.showSelf)) return@forEachIndexed
            
            val tag = display.cache[player.uniqueID] ?: return@forEachIndexed
            if (!display.loadOrRender(player)) return@forEachIndexed

            // Calculate offset (vanilla behavior + config)
            var offset = 0.3
            val hasScoreboardObjective = player.worldScoreboard?.getObjectiveInDisplaySlot(2) != null
            
            // Only adjust for scoreboard if close (vanilla behavior)
            val isCloseToLocalPlayer = player.getDistanceSqToEntity(localPlayer) < 100
            if (hasScoreboardObjective && isCloseToLocalPlayer) {
                offset *= 2
            }
            
            // FIX: Removed the block that forced offset to 0.0 for the local player.
            // This ensures your tag is lifted 0.3 blocks up just like everyone else's.
            
            // Shift tag down when sneaking
            if (player.isSneaking) {
                offset -= 0.25
            }
            
            offset += displayManager.config.offset
            
            // Render using the ported logic
            renderName(tag, player, event.x, event.y + offset + index * 0.3, event.z)
        }
    }

    private fun renderName(tag: LevelheadTag, entityIn: EntityPlayer, x: Double, y: Double, z: Double) {
        val fontRenderer = Minecraft.getMinecraft().fontRendererObj
        // Original Sk1er scale calculation
        val textScale = 0.016666668f * 1.6f * displayManager.config.fontSize.toFloat()
        
        // Push Matrix using Essential UGraphics/GL wrapper
        UGraphics.GL.pushMatrix()
        
        val mc = Minecraft.getMinecraft()
        val xMultiplier = if (mc.gameSettings.thirdPersonView == 2) -1 else 1
        
        // Translate to position
        UGraphics.GL.translate(x.toFloat(), (y + entityIn.height + 0.5).toFloat(), z.toFloat())
        GL11.glNormal3f(0.0f, 1.0f, 0.0f)
        
        // Billboard rotation
        val renderManager = mc.renderManager
        UGraphics.GL.rotate(-renderManager.playerViewY, 0.0f, 1.0f, 0.0f)
        UGraphics.GL.rotate(renderManager.playerViewX * xMultiplier, 1.0f, 0.0f, 0.0f)
        
        // Apply Scale
        UGraphics.GL.scale(-textScale, -textScale, textScale)
        
        // GL State setup matches original source exactly
        UGraphics.disableLighting()
        UGraphics.depthMask(false)
        UGraphics.disableDepth()
        UGraphics.enableBlend()
        @Suppress("DEPRECATION")
        UGraphics.tryBlendFuncSeparate(GL11.GL_SRC_ALPHA, GL11.GL_ONE_MINUS_SRC_ALPHA, GL11.GL_ONE, GL11.GL_ZERO)

        val stringWidth = fontRenderer.getStringWidth(tag.getString()) / 2

        // Draw Background using UGraphics
        if (displayManager.config.showBackground) {
            val opacity = displayManager.config.backgroundOpacity.coerceIn(0f, 1f)
            val uGraphics = UGraphics.getFromTessellator()
            
            @Suppress("DEPRECATION")
            uGraphics.beginWithDefaultShader(UGraphics.DrawMode.QUADS, DefaultVertexFormats.POSITION_COLOR)
            
            uGraphics.pos(UMatrixStack.Compat.get(), (-stringWidth - 2).toDouble(), -1.0, 0.0)
                .color(0.0f, 0.0f, 0.0f, opacity).endVertex()
            uGraphics.pos(UMatrixStack.Compat.get(), (-stringWidth - 2).toDouble(), 8.0, 0.0)
                .color(0.0f, 0.0f, 0.0f, opacity).endVertex()
            uGraphics.pos(UMatrixStack.Compat.get(), (stringWidth + 1).toDouble(), 8.0, 0.0)
                .color(0.0f, 0.0f, 0.0f, opacity).endVertex()
            uGraphics.pos(UMatrixStack.Compat.get(), (stringWidth + 1).toDouble(), -1.0, 0.0)
                .color(0.0f, 0.0f, 0.0f, opacity).endVertex()
            
            uGraphics.drawDirect()
        }

        // Render the actual text
        renderString(fontRenderer, tag)

        // Restore GL State
        UGraphics.enableLighting()
        @Suppress("DEPRECATION")
        UGraphics.disableBlend()
        UGraphics.color4f(1.0f, 1.0f, 1.0f, 1.0f)
        UGraphics.GL.popMatrix()
    }

    private fun renderString(renderer: FontRenderer, tag: LevelheadTag) {
        var x = -renderer.getStringWidth(tag.getString()) / 2
        
        // Render Header
        renderComponent(renderer, tag.header, x)
        x += renderer.getStringWidth(tag.header.value)
        
        // Render Footer
        renderComponent(renderer, tag.footer, x)
    }

    private fun renderComponent(renderer: FontRenderer, component: LevelheadTag.LevelheadComponent, x: Int) {
        // Pass 1: Shadow / Depth-disabled pass
        @Suppress("DEPRECATION")
        UGraphics.disableDepth()
        @Suppress("DEPRECATION")
        UGraphics.depthMask(false)
        
        if (component.chroma) {
            renderer.drawString(component.value, x, 0, DarkChromaColor)
        } else {
            renderer.drawString(component.value, x, 0, component.color.withAlpha(0.2f).rgb)
        }

        // Pass 2: Main Text
        @Suppress("DEPRECATION")
        UGraphics.enableDepth()
        @Suppress("DEPRECATION")
        UGraphics.depthMask(true)
        
        UGraphics.directColor3f(1.0f, 1.0f, 1.0f)
        
        if (component.chroma) {
            renderer.drawString(component.value, x, 0, ChromaColor)
        } else {
            UGraphics.color4f(
                component.color.red / 255f,
                component.color.green / 255f,
                component.color.blue / 255f,
                0.5f
            )
            renderer.drawString(component.value, x, 0, component.color.rgb)
        }
    }

    /**
     * Stub for compatibility with Levelhead.kt
     */
    fun performScheduledCleanup() {
        // No-op: This renderer implementation does not use the cache that required cleanup.
    }
}