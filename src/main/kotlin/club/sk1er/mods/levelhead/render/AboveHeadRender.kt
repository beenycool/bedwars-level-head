package club.sk1er.mods.levelhead.render

import club.sk1er.mods.levelhead.Levelhead
import club.sk1er.mods.levelhead.Levelhead.displayManager
import club.sk1er.mods.levelhead.display.LevelheadTag
import club.sk1er.mods.levelhead.core.BedwarsModeDetector
import club.sk1er.mods.levelhead.config.DisplayConfig
import club.sk1er.mods.levelhead.config.MasterConfig
import club.sk1er.mods.levelhead.util.Bedwars
import net.minecraft.client.Minecraft
import net.minecraft.client.gui.FontRenderer
import net.minecraft.entity.EntityLivingBase
import net.minecraft.entity.player.EntityPlayer
import net.minecraftforge.client.event.RenderLivingEvent
import net.minecraftforge.fml.common.eventhandler.SubscribeEvent
import org.lwjgl.opengl.GL11
import org.polyfrost.polyui.color.PolyColor
import org.polyfrost.polyui.utils.Matrix4f
import org.polyfrost.polyui.utils.U
import java.awt.Color

class AboveHeadRender {

    @SubscribeEvent
    fun render(event: RenderLivingEvent.Specials.Post<EntityLivingBase>) {
        if (!MasterConfig.enabled || !DisplayConfig.enabled) return
        if (!Bedwars.isHypixel()) return
        if (Minecraft.getMinecraft().gameSettings.hideGUI) return
        if (!BedwarsModeDetector.shouldRenderTags()) return

        if (event.entity !is EntityPlayer) return
        val player = event.entity as EntityPlayer

        val localPlayer = Minecraft.getMinecraft().thePlayer

        displayManager.aboveHead.forEachIndexed { index, display ->
            if (!display.config.enabled || (player.isSelf && !display.config.showSelf)) return@forEachIndexed
            val tag = display.cache[player.uniqueID]
            if (display.loadOrRender(player) && tag != null) {
                // increase offset if there's something in the above name slot for scoreboards
                var offset = 0.3
                val hasScoreboardObjective = player.worldScoreboard?.getObjectiveInDisplaySlot(2) != null
                val isCloseToLocalPlayer = localPlayer?.let { player.getDistanceSqToEntity(it) < 100 } ?: false
                if (hasScoreboardObjective && isCloseToLocalPlayer) {
                    offset *= 2
                }
                if (player.isSelf) offset = 0.0
                offset += displayManager.config.offset
                renderName(tag, player, event.x, event.y + offset + index * 0.3, event.z)
            }
        }
    }

    private val EntityPlayer.isSelf: Boolean
        get() = Minecraft.getMinecraft().thePlayer?.uniqueID == this.uniqueID

    private fun renderName(tag: LevelheadTag, entityIn: EntityPlayer, x: Double, y: Double, z: Double) {
        val fontrenderer = Minecraft.getMinecraft().fontRendererObj
        val textScale = 0.016666668f * 1.6f * MasterConfig.fontSize
        GL11.glPushMatrix()
        val mc = Minecraft.getMinecraft()
        val xMultiplier = if (mc.gameSettings.thirdPersonView == 2) -1 else 1
        
        // Set up transformation matrix using PolyUI
        val matrix = Matrix4f.create()
        matrix.translate(x.toFloat() + 0.0f, (y + entityIn.height + 0.5f).toFloat(), z.toFloat())
        GL11.glNormal3f(0.0f, 1.0f, 0.0f)
        val renderManager = mc.renderManager
        matrix.rotate(-renderManager.playerViewY * (Math.PI / 180.0f).toFloat(), 0.0f, 1.0f, 0.0f)
        matrix.rotate(renderManager.playerViewX * xMultiplier * (Math.PI / 180.0f).toFloat(), 1.0f, 0.0f, 0.0f)
        matrix.scale(-textScale, -textScale, textScale)
        
        // Apply matrix
        U.applyMatrix(matrix)
        
        // Set up OpenGL state using PolyUI patterns
        disableLighting()
        depthMask(false)
        disableDepth()
        enableBlend()
        GL11.glBlendFuncSeparate(GL11.GL_SRC_ALPHA, GL11.GL_ONE_MINUS_SRC_ALPHA, GL11.GL_ONE, GL11.GL_ZERO)
        
        // Render background
        renderBackground(fontrenderer, tag)
        
        // Render string
        renderString(fontrenderer, tag)
        
        // Restore OpenGL state
        enableLighting()
        disableBlend()
        color4f(1.0f, 1.0f, 1.0f, 1.0f)
        
        GL11.glPopMatrix()
    }

    private fun renderBackground(renderer: FontRenderer, tag: LevelheadTag) {
        val stringWidth = renderer.getStringWidth(tag.getString()) shr 1
        
        // Render background using PolyUI renderer
        val backgroundColor = PolyColor(0.0f, 0.0f, 0.0f, 0.25f)
        drawQuad(
            (-stringWidth - 2).toFloat(),
            -1.0f,
            0.0f,
            (stringWidth + 1).toFloat(),
            8.0f,
            0.0f,
            backgroundColor
        )
    }

    private fun drawQuad(x1: Float, y1: Float, z1: Float, x2: Float, y2: Float, z2: Float, color: PolyColor) {
        // Manual quad rendering using OpenGL
        GL11.glBegin(GL11.GL_QUADS)
        color4f(color.r, color.g, color.b, color.a)
        GL11.glVertex3f(x1, y1, z1)
        GL11.glVertex3f(x1, y2, z2)
        GL11.glVertex3f(x2, y2, z2)
        GL11.glVertex3f(x2, y1, z1)
        GL11.glEnd()
    }

    private fun renderString(renderer: FontRenderer, tag: LevelheadTag) {
        var x = -(renderer.getStringWidth(tag.getString()) shr 1)
        // Render header
        render(renderer, tag.header, x)
        x += renderer.getStringWidth(tag.header.value)
        // Render footer
        render(renderer, tag.footer, x)
    }

    private fun render(renderer: FontRenderer, component: LevelheadTag.LevelheadComponent, x: Int) {
        disableDepth()
        depthMask(false)
        
        val color = Color(component.color.red, component.color.green, component.color.blue, 51) // 0.2f alpha
        
        if (component.chroma) {
            // Use OneConfig's chroma color system
            renderer.drawString(component.value, x, 0, getChromaColor(false))
        } else {
            renderer.drawString(component.value, x, 0, color.rgb)
        }
        
        enableDepth()
        depthMask(true)
        color4f(1.0f, 1.0f, 1.0f, 1.0f)
        
        if (component.chroma) {
            renderer.drawString(component.value, x, 0, getChromaColor(true))
        } else {
            color4f(
                component.color.red / 255f,
                component.color.green / 255f,
                component.color.blue / 255f,
                0.5f
            )
            renderer.drawString(component.value, x, 0, component.color.rgb)
        }
    }

    private fun getChromaColor(bright: Boolean): Int {
        val hue = System.currentTimeMillis() % 1000 / 1000f
        val saturation = if (bright) 0.8f else 0.2f
        val brightness = if (bright) 0.8f else 0.2f
        return Color.HSBtoRGB(hue, saturation, brightness)
    }

    // OpenGL helper functions using PolyUI patterns
    private fun disableLighting() {
        GL11.glDisable(GL11.GL_LIGHTING)
    }

    private fun enableLighting() {
        GL11.glEnable(GL11.GL_LIGHTING)
    }

    private fun enableBlend() {
        GL11.glEnable(GL11.GL_BLEND)
    }

    private fun disableBlend() {
        GL11.glDisable(GL11.GL_BLEND)
    }

    private fun enableDepth() {
        GL11.glEnable(GL11.GL_DEPTH_TEST)
    }

    private fun disableDepth() {
        GL11.glDisable(GL11.GL_DEPTH_TEST)
    }

    private fun depthMask(mask: Boolean) {
        GL11.glDepthMask(mask)
    }

    private fun color4f(r: Float, g: Float, b: Float, a: Float) {
        GL11.glColor4f(r, g, b, a)
    }
}