package club.sk1er.mods.levelhead.render

import club.sk1er.mods.levelhead.Levelhead
import club.sk1er.mods.levelhead.Levelhead.displayManager
import club.sk1er.mods.levelhead.config.LevelheadConfig
import club.sk1er.mods.levelhead.core.BedwarsModeDetector
import club.sk1er.mods.levelhead.display.LevelheadTag
import gg.essential.universal.UGraphics
import gg.essential.universal.UMatrixStack
import net.minecraft.client.Minecraft
import net.minecraft.client.renderer.GlStateManager
import net.minecraft.client.renderer.vertex.DefaultVertexFormats
import net.minecraft.entity.player.EntityPlayer
import net.minecraftforge.client.event.RenderLivingEvent
import net.minecraftforge.fml.common.eventhandler.SubscribeEvent
import org.lwjgl.opengl.GL11
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

object AboveHeadRender {
    // Reusable MatrixStack (Similar to UMatrixStack.Compat.get() in the Sk1er implementation)
    private val matrixStack = UMatrixStack()

    private val lastRenderTime: ConcurrentHashMap<UUID, Long> = ConcurrentHashMap()
    private var lastCleanupTime: Long = 0
    private const val CLEANUP_INTERVAL_MS = 60000L
    private const val MAX_ENTRY_AGE_MS = 300000L

    private fun cleanupOldRenderTimes() {
        val now = System.currentTimeMillis()
        if (now - lastCleanupTime < CLEANUP_INTERVAL_MS) return
        lastCleanupTime = now
        val cutoff = now - MAX_ENTRY_AGE_MS
        lastRenderTime.entries.removeIf { it.value < cutoff }
    }

    @SubscribeEvent
    fun onRenderLiving(event: RenderLivingEvent.Specials.Pre<*>) {
        val entity = event.entity
        if (entity !is EntityPlayer) return

        // 1. Basic Checks
        if (!LevelheadConfig.enabled || !displayManager.config.enabled) return
        if (!Levelhead.isOnHypixel()) return
        if (!BedwarsModeDetector.shouldRenderTags()) return

        val minecraft = Minecraft.getMinecraft()
        val localPlayer = minecraft.thePlayer ?: return

        // 2. Distance Culling
        val renderDistance = displayManager.config.renderDistance
        val distanceSq = entity.getDistanceSqToEntity(localPlayer)
        val maxDistanceSq = (renderDistance * renderDistance).toDouble().coerceAtMost(4096.0)
        if (distanceSq > maxDistanceSq) return

        cleanupOldRenderTimes()

        // 3. Throttling
        val throttleMs = displayManager.config.renderThrottleMs
        if (throttleMs > 0) {
            val now = System.currentTimeMillis()
            val lastRender = lastRenderTime[entity.uniqueID]
            if (lastRender != null && (now - lastRender) < throttleMs) return
            lastRenderTime[entity.uniqueID] = now
        }

        // 4. Visibility Checks
        if (entity == localPlayer) {
            if (minecraft.gameSettings.thirdPersonView == 0) return
            if (!LevelheadConfig.showSelf) return
        }
        if (entity.isInvisibleToPlayer(localPlayer) || entity.isSneaking) return

        val display = displayManager.aboveHead.firstOrNull() ?: return
        if (!display.config.enabled) return

        val tag = display.cache[entity.uniqueID] ?: return

        // 5. Render
        renderName(tag, entity, event.x, event.y + entity.height + 0.5, event.z)
    }

    /**
     * Optimized renderer adopted from Sk1er LLC implementation.
     * Uses primitive colors and shared MatrixStack to eliminate allocations.
     */
    private fun renderName(tag: LevelheadTag, entityIn: EntityPlayer, x: Double, y: Double, z: Double) {
        val minecraft = Minecraft.getMinecraft()
        val fontRenderer = minecraft.fontRendererObj ?: return
        val renderManager = minecraft.renderManager ?: return

        val text = tag.getString()
        if (text.isBlank()) return

        // Calculate Scale
        // Sk1er impl uses: 0.016666668f * 1.6f * fontSize
        // We map LevelheadConfig.textScale to this
        val textScale = 0.016666668f * 1.6f * LevelheadConfig.textScale

        GlStateManager.pushMatrix()
        GlStateManager.translate(x, y, z)
        GL11.glNormal3f(0.0f, 1.0f, 0.0f)
        
        GlStateManager.rotate(-renderManager.playerViewY, 0.0f, 1.0f, 0.0f)
        GlStateManager.rotate(renderManager.playerViewX, 1.0f, 0.0f, 0.0f)
        GlStateManager.scale(-textScale, -textScale, textScale)

        GlStateManager.disableLighting()
        GlStateManager.depthMask(false)
        GlStateManager.disableDepth() // Sk1er impl disables depth for background
        GlStateManager.enableBlend()
        GlStateManager.tryBlendFuncSeparate(GL11.GL_SRC_ALPHA, GL11.GL_ONE_MINUS_SRC_ALPHA, GL11.GL_ONE, GL11.GL_ZERO)

        val headerWidth = tag.header.getWidth(fontRenderer)
        val footerWidth = tag.footer.getWidth(fontRenderer)
        val stringWidth = (headerWidth + footerWidth) shr 1

        // --- BACKGROUND RENDERING (Optimized) ---
        if (displayManager.config.showBackground) {
            GlStateManager.disableTexture2D()
            
            // Get opacity as primitive float (No Color object creation!)
            val opacity = displayManager.config.backgroundOpacity.coerceIn(0f, 1f)
            
            val uGraphics = UGraphics.getFromTessellator()
            uGraphics.beginWithDefaultShader(UGraphics.DrawMode.QUADS, DefaultVertexFormats.POSITION_COLOR)

            // Use the shared matrixStack instance
            // Using standard nametag bounds (-1.0 to 8.0) or fontHeight
            val left = (-stringWidth - 2).toDouble()
            val right = (stringWidth + 2).toDouble()
            val top = -2.0 // Slightly above text
            val bottom = 9.0 // Standard text height (8) + padding

            // Direct vertex calls with primitive colors
            uGraphics.pos(matrixStack, left, top, 0.0).color(0f, 0f, 0f, opacity).endVertex()
            uGraphics.pos(matrixStack, left, bottom, 0.0).color(0f, 0f, 0f, opacity).endVertex()
            uGraphics.pos(matrixStack, right, bottom, 0.0).color(0f, 0f, 0f, opacity).endVertex()
            uGraphics.pos(matrixStack, right, top, 0.0).color(0f, 0f, 0f, opacity).endVertex()

            uGraphics.drawDirect()
            GlStateManager.enableTexture2D()
        }

        // --- TEXT RENDERING ---
        // Sk1er impl renders this manually, but fontRenderer is fine if we manage state
        val startX = -stringWidth
        
        // Determine primitive colors for text
        val headerColorRGB = if (LevelheadConfig.useCustomColor) LevelheadConfig.starColor.rgb else tag.header.color.rgb
        val footerColorRGB = if (LevelheadConfig.useCustomColor) LevelheadConfig.starColor.rgb else tag.footer.color.rgb

        // Re-enable depth for text if desired, or keep disabled like Sk1er impl
        // Sk1er impl keeps depth disabled for text rendering in the method shown
        
        if (tag.header.value.isNotBlank()) {
            // FIX: Added .toFloat() and 0f
            fontRenderer.drawString(tag.header.value, startX.toFloat(), 0f, headerColorRGB, true) // true = shadow
        }
        
        val headerOffset = fontRenderer.getStringWidth(tag.header.value)
        if (tag.footer.value.isNotBlank()) {
            // FIX: Added .toFloat() and 0f
            fontRenderer.drawString(tag.footer.value, (startX + headerOffset).toFloat(), 0f, footerColorRGB, true)
        }

        GlStateManager.enableDepth() // Restore depth
        GlStateManager.enableLighting()
        GlStateManager.disableBlend()
        GlStateManager.color(1.0f, 1.0f, 1.0f, 1.0f)
        GlStateManager.popMatrix()
    }
}