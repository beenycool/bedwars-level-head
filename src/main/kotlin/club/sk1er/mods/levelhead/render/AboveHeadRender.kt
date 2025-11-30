package club.sk1er.mods.levelhead.render

import club.sk1er.mods.levelhead.Levelhead
import club.sk1er.mods.levelhead.Levelhead.displayManager
import club.sk1er.mods.levelhead.config.LevelheadConfig
import club.sk1er.mods.levelhead.core.BedwarsModeDetector
import net.minecraft.client.Minecraft
import net.minecraft.client.renderer.GlStateManager
import net.minecraft.entity.player.EntityPlayer
import net.minecraftforge.client.event.RenderLivingEvent
import net.minecraftforge.fml.common.eventhandler.SubscribeEvent
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

object AboveHeadRender {
    // Track last render time per player for throttling
    private val lastRenderTime: ConcurrentHashMap<UUID, Long> = ConcurrentHashMap()

    @SubscribeEvent
    fun onRenderLiving(event: RenderLivingEvent.Specials.Pre<*>) {
        val entity = event.entity
        if (entity !is EntityPlayer) return

        // Basic checks to ensure we should be rendering
        if (!displayManager.config.enabled) return
        if (!LevelheadConfig.enabled) return
        if (!Levelhead.isOnHypixel()) return

        // This check ensures tags only show when Bedwars mode is active (lobby or game)
        if (!BedwarsModeDetector.shouldRenderTags()) return

        val minecraft = Minecraft.getMinecraft()
        val localPlayer = minecraft.thePlayer ?: return

        // Skip rendering for ourselves in first-person view
        if (entity == localPlayer && minecraft.gameSettings.thirdPersonView == 0) return

        // Get the primary display configuration
        val display = displayManager.aboveHead.firstOrNull() ?: return
        if (!display.config.enabled) return

        // Check showSelf setting
        if (entity == localPlayer && !display.config.showSelf) return

        // Retrieve the cached stats tag for this player
        val tag = display.cache[entity.uniqueID] ?: return

        // Build the text to display
        val text = "${tag.header.value}${tag.footer.value}"
        if (text.isBlank()) return

        // Calculate position
        val x = event.x
        var y = event.y + entity.height + 0.5
        val z = event.z

        // Adjust for sneaking
        if (entity.isSneaking) {
            y -= 0.25
        }

        // Begin OpenGL rendering
        GlStateManager.pushMatrix()

        // Translate to position above player's head
        GlStateManager.translate(x, y, z)

        // Setup normal vector
        GlStateManager.glNormal3f(0.0f, 1.0f, 0.0f)

        // Rotate to face the player (billboard effect)
        val renderManager = minecraft.renderManager
        GlStateManager.rotate(-renderManager.playerViewY, 0.0f, 1.0f, 0.0f)
        GlStateManager.rotate(renderManager.playerViewX, 1.0f, 0.0f, 0.0f)

        // Apply scaling with config value, guard against zero or negative values
        val MIN_SCALE_EPSILON = 0.001f
        val effectiveScale = kotlin.math.max(kotlin.math.abs(LevelheadConfig.textScale), MIN_SCALE_EPSILON)
        val scale = 0.025f * effectiveScale
        GlStateManager.scale(-scale, -scale, scale)

        // Setup OpenGL state for text rendering
        GlStateManager.disableLighting()
        GlStateManager.depthMask(false)
        GlStateManager.enableBlend()
        GlStateManager.tryBlendFuncSeparate(770, 771, 1, 0)
        GlStateManager.disableTexture2D()

        val fontRenderer = minecraft.fontRendererObj
        
        // Calculate widths for proper centering
        val headerText = tag.header.value
        val footerText = tag.footer.value
        val headerWidth = fontRenderer.getStringWidth(headerText)
        val footerWidth = fontRenderer.getStringWidth(footerText)
        val totalWidth = headerWidth + footerWidth
        val halfWidth = totalWidth / 2

        // Draw semi-transparent background
        val backgroundColor = 0x40000000 // 25% opacity black
        drawRect(-halfWidth - 2, -2, halfWidth + 2, fontRenderer.FONT_HEIGHT, backgroundColor)

        // Re-enable textures for text rendering
        GlStateManager.enableTexture2D()

        // Determine colors to use - preserve per-section colors
        val headerColor = if (LevelheadConfig.useCustomColor) {
            LevelheadConfig.starColor.rgb
        } else {
            tag.header.color.rgb
        }
        
        val footerColor = if (LevelheadConfig.useCustomColor) {
            LevelheadConfig.starColor.rgb
        } else {
            tag.footer.color.rgb
        }

        // Draw header and footer separately with their respective colors
        val startX = -halfWidth.toFloat()
        if (headerText.isNotBlank()) {
            fontRenderer.drawStringWithShadow(headerText, startX, 0f, headerColor)
        }
        if (footerText.isNotBlank()) {
            fontRenderer.drawStringWithShadow(footerText, startX + headerWidth, 0f, footerColor)
        }

        // Cleanup OpenGL state
        GlStateManager.depthMask(true)
        GlStateManager.enableLighting()
        GlStateManager.disableBlend()
        GlStateManager.color(1.0f, 1.0f, 1.0f, 1.0f)
        GlStateManager.popMatrix()
    }

    /**
     * Draws a rectangle using OpenGL.
     * This is used for the semi-transparent background behind the text.
     */
    private fun drawRect(left: Int, top: Int, right: Int, bottom: Int, color: Int) {
        val alpha = (color shr 24 and 255) / 255.0f
        val red = (color shr 16 and 255) / 255.0f
        val green = (color shr 8 and 255) / 255.0f
        val blue = (color and 255) / 255.0f

        val tessellator = net.minecraft.client.renderer.Tessellator.getInstance()
        val worldRenderer = tessellator.worldRenderer

        GlStateManager.color(red, green, blue, alpha)
        worldRenderer.begin(7, net.minecraft.client.renderer.vertex.DefaultVertexFormats.POSITION)
        worldRenderer.pos(left.toDouble(), bottom.toDouble(), 0.0).endVertex()
        worldRenderer.pos(right.toDouble(), bottom.toDouble(), 0.0).endVertex()
        worldRenderer.pos(right.toDouble(), top.toDouble(), 0.0).endVertex()
        worldRenderer.pos(left.toDouble(), top.toDouble(), 0.0).endVertex()
        tessellator.draw()
    }
}
