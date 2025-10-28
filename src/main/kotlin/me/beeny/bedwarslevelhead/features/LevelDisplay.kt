package me.beeny.bedwarslevelhead.features

import me.beeny.bedwarslevelhead.BedwarsLevelHead
import me.beeny.bedwarslevelhead.utils.ColorUtils
import net.minecraft.client.Minecraft
import net.minecraft.client.gui.FontRenderer
import net.minecraft.client.renderer.GlStateManager

object LevelDisplay {

    fun formatLevelText(level: Int): String {
        var format = BedwarsLevelHead.config.levelFormat
        format = format.replace("%level%", level.toString())
        return ColorUtils.translateColorCodes(format)
    }

    /**
     * Render a billboarded text at the given world coordinates (x, y, z).
     * Coordinates must be in world-space. This function handles transforming from world to view space,
     * billboarding towards the camera, and applying the configured text scale.
     */
    fun renderBillboardedTextAt(text: String, x: Double, y: Double, z: Double) {
        val mc = Minecraft.getMinecraft()
        val renderManager = mc.renderManager
        val fontRenderer: FontRenderer = mc.fontRendererObj

        GlStateManager.pushMatrix()

        // Translate to camera-relative position
        GlStateManager.translate(
            (x - renderManager.viewerPosX).toFloat(),
            (y - renderManager.viewerPosY).toFloat(),
            (z - renderManager.viewerPosZ).toFloat()
        )

        // Rotate to face the camera (billboard)
        GlStateManager.rotate(-renderManager.playerViewY, 0.0f, 1.0f, 0.0f)
        GlStateManager.rotate(renderManager.playerViewX, 1.0f, 0.0f, 0.0f)

        // Apply scale (0.016 is a common factor to convert font pixels to world units)
        val scale = (BedwarsLevelHead.config.textScale * 0.016f)
        GlStateManager.scale(-scale, -scale, scale)

        // Setup render state
        GlStateManager.disableLighting()
        GlStateManager.enableBlend()
        GlStateManager.tryBlendFuncSeparate(770, 771, 1, 0)
        GlStateManager.depthMask(false)

        // Draw centered at origin after transforms
        val width = fontRenderer.getStringWidth(text)
        fontRenderer.drawStringWithShadow(text, (-width / 2.0f), 0.0f, 0xFFFFFF)

        // Restore state
        GlStateManager.depthMask(true)
        GlStateManager.disableBlend()
        GlStateManager.enableLighting()

        GlStateManager.popMatrix()
    }

    /**
     * Render a 2D HUD overlay text at a given screen corner/center.
     */
    fun renderHudOverlay(text: String) {
        val mc = Minecraft.getMinecraft()
        val fontRenderer: FontRenderer = mc.fontRendererObj
        val sr = net.minecraft.client.gui.ScaledResolution(mc)

        val scale = BedwarsLevelHead.config.textScale
        val width = fontRenderer.getStringWidth(text)
        val height = fontRenderer.FONT_HEIGHT

        val margin = 4
        val screenW = sr.scaledWidth
        val screenH = sr.scaledHeight

        var drawX = margin.toFloat()
        var drawY = margin.toFloat()

        when (BedwarsLevelHead.config.hudPosition) {
            0 -> { /* Top Left */
                drawX = margin.toFloat()
                drawY = margin.toFloat()
            }
            1 -> { /* Top Center */
                drawX = (screenW / 2f) - (width * scale / 2f)
                drawY = margin.toFloat()
            }
            2 -> { /* Top Right */
                drawX = (screenW - margin - width * scale)
                drawY = margin.toFloat()
            }
            3 -> { /* Bottom Left */
                drawX = margin.toFloat()
                drawY = (screenH - margin - height * scale)
            }
            4 -> { /* Bottom Center */
                drawX = (screenW / 2f) - (width * scale / 2f)
                drawY = (screenH - margin - height * scale)
            }
            5 -> { /* Bottom Right */
                drawX = (screenW - margin - width * scale)
                drawY = (screenH - margin - height * scale)
            }
        }

        GlStateManager.pushMatrix()
        GlStateManager.disableLighting()
        GlStateManager.enableBlend()
        GlStateManager.tryBlendFuncSeparate(770, 771, 1, 0)

        GlStateManager.translate(drawX, drawY, 0f)
        GlStateManager.scale(scale, scale, 1f)
        fontRenderer.drawStringWithShadow(text, 0f, 0f, 0xFFFFFF)

        GlStateManager.disableBlend()
        GlStateManager.enableLighting()
        GlStateManager.popMatrix()
    }
}