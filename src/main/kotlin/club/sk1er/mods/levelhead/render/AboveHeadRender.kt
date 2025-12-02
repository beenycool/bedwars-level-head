package club.sk1er.mods.levelhead.render

import club.sk1er.mods.levelhead.Levelhead
import club.sk1er.mods.levelhead.Levelhead.displayManager
import club.sk1er.mods.levelhead.config.LevelheadConfig
import club.sk1er.mods.levelhead.core.BedwarsModeDetector
import club.sk1er.mods.levelhead.display.LevelheadTag
import net.minecraft.client.Minecraft
import net.minecraft.client.renderer.GlStateManager
import net.minecraft.client.renderer.Tessellator
import net.minecraft.client.renderer.vertex.DefaultVertexFormats
import net.minecraft.entity.player.EntityPlayer
import net.minecraftforge.client.event.RenderLivingEvent
import net.minecraftforge.fml.common.eventhandler.SubscribeEvent
import org.lwjgl.opengl.GL11
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

object AboveHeadRender {
    // Track render times for throttling
    private val lastRenderTime: ConcurrentHashMap<UUID, Long> = ConcurrentHashMap()
    
    // Optimization: Check time once per frame-ish, not per entity
    private var lastCleanupTime: Long = 0
    private const val CLEANUP_INTERVAL_MS = 60000L
    private const val MAX_ENTRY_AGE_MS = 300000L

    @SubscribeEvent
    fun onRenderLiving(event: RenderLivingEvent.Specials.Pre<*>) {
        val entity = event.entity
        if (entity !is EntityPlayer) return

        // 1. Ultra-fast checks (booleans only)
        if (!LevelheadConfig.enabled || !displayManager.config.enabled) return
        
        // 2. Context checks (slightly more expensive)
        if (!Levelhead.isOnHypixel()) return
        if (!BedwarsModeDetector.shouldRenderTags()) return

        val minecraft = Minecraft.getMinecraft()
        val localPlayer = minecraft.thePlayer ?: return

        // 3. Distance Culling (Math only, no allocs)
        val renderDistance = displayManager.config.renderDistance
        val distanceSq = entity.getDistanceSqToEntity(localPlayer)
        val maxDistanceSq = (renderDistance * renderDistance).toDouble().coerceAtMost(4096.0)
        if (distanceSq > maxDistanceSq) return

        // 4. Cleanup Maintenance (Once per minute)
        val now = System.currentTimeMillis()
        if (now - lastCleanupTime > CLEANUP_INTERVAL_MS) {
            lastCleanupTime = now
            val cutoff = now - MAX_ENTRY_AGE_MS
            // RemoveIf might alloc an iterator, but it's rare (once per min)
            lastRenderTime.entries.removeIf { it.value < cutoff }
        }

        // 5. Throttling
        val throttleMs = displayManager.config.renderThrottleMs
        if (throttleMs > 0) {
            val lastRender = lastRenderTime[entity.uniqueID]
            if (lastRender != null && (now - lastRender) < throttleMs) return
            lastRenderTime[entity.uniqueID] = now // Autoboxing here is unavoidable but minor
        }

        // 6. Visibility Checks
        if (entity == localPlayer) {
            if (minecraft.gameSettings.thirdPersonView == 0) return
            if (!LevelheadConfig.showSelf) return
        }
        if (entity.isInvisibleToPlayer(localPlayer) || entity.isSneaking) return

        val display = displayManager.aboveHead.firstOrNull() ?: return
        if (!display.config.enabled) return

        val tag = display.cache[entity.uniqueID] ?: return

        // 7. Render
        renderName(tag, entity, event.x, event.y + entity.height + 0.5, event.z)
    }

    private fun renderName(tag: LevelheadTag, entityIn: EntityPlayer, x: Double, y: Double, z: Double) {
        // OPTIMIZATION: Do not call tag.getString() here. It creates a new String every frame.
        // Just check components directly.
        val headerEmpty = tag.header.value.isEmpty()
        val footerEmpty = tag.footer.value.isEmpty()
        if (headerEmpty && footerEmpty) return

        val minecraft = Minecraft.getMinecraft()
        val fontRenderer = minecraft.fontRendererObj ?: return
        val renderManager = minecraft.renderManager ?: return

        // Calculate Scale
        val textScale = 0.016666668f * 1.6f * LevelheadConfig.textScale

        GlStateManager.pushMatrix()
        GlStateManager.translate(x, y, z)
        GL11.glNormal3f(0.0f, 1.0f, 0.0f)
        
        GlStateManager.rotate(-renderManager.playerViewY, 0.0f, 1.0f, 0.0f)
        GlStateManager.rotate(renderManager.playerViewX, 1.0f, 0.0f, 0.0f)
        GlStateManager.scale(-textScale, -textScale, textScale)

        GlStateManager.disableLighting()
        GlStateManager.depthMask(false)
        GlStateManager.disableDepth()
        GlStateManager.enableBlend()
        GlStateManager.tryBlendFuncSeparate(GL11.GL_SRC_ALPHA, GL11.GL_ONE_MINUS_SRC_ALPHA, GL11.GL_ONE, GL11.GL_ZERO)

        val headerWidth = tag.header.getWidth(fontRenderer)
        val footerWidth = tag.footer.getWidth(fontRenderer)
        val stringWidth = (headerWidth + footerWidth) shr 1

        // --- BACKGROUND RENDERING ---
        if (displayManager.config.showBackground) {
            GlStateManager.disableTexture2D()
            
            // Raw float opacity (No object creation)
            val opacity = displayManager.config.backgroundOpacity.coerceIn(0f, 1f)
            
            // Use Tessellator directly for zero-allocation rendering
            val tessellator = Tessellator.getInstance()
            val worldRenderer = tessellator.worldRenderer
            
            worldRenderer.begin(7, DefaultVertexFormats.POSITION_COLOR)

            val left = (-stringWidth - 2).toDouble()
            val right = (stringWidth + 2).toDouble()
            val top = -2.0
            val bottom = 9.0

            // Manually emit vertices with color (r=0, g=0, b=0, a=opacity)
            worldRenderer.pos(left, top, 0.0).color(0f, 0f, 0f, opacity).endVertex()
            worldRenderer.pos(left, bottom, 0.0).color(0f, 0f, 0f, opacity).endVertex()
            worldRenderer.pos(right, bottom, 0.0).color(0f, 0f, 0f, opacity).endVertex()
            worldRenderer.pos(right, top, 0.0).color(0f, 0f, 0f, opacity).endVertex()

            tessellator.draw()
            
            GlStateManager.enableTexture2D()
        }

        // --- TEXT RENDERING ---
        val startX = -stringWidth
        
        // Colors as primitives (int)
        val headerColorRGB = if (LevelheadConfig.useCustomColor) LevelheadConfig.starColor.rgb else tag.header.color.rgb
        val footerColorRGB = if (LevelheadConfig.useCustomColor) LevelheadConfig.starColor.rgb else tag.footer.color.rgb

        if (!headerEmpty) {
            fontRenderer.drawString(tag.header.value, startX.toFloat(), 0f, headerColorRGB, true)
        }
        
        if (!footerEmpty) {
            val headerOffset = fontRenderer.getStringWidth(tag.header.value)
            fontRenderer.drawString(tag.footer.value, (startX + headerOffset).toFloat(), 0f, footerColorRGB, true)
        }

        GlStateManager.enableDepth()
        GlStateManager.enableLighting()
        GlStateManager.disableBlend()
        GlStateManager.color(1.0f, 1.0f, 1.0f, 1.0f)
        GlStateManager.popMatrix()
    }
}