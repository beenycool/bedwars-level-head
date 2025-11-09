package club.sk1er.mods.levelhead.render

import club.sk1er.mods.levelhead.Levelhead
import club.sk1er.mods.levelhead.Levelhead.displayManager
import club.sk1er.mods.levelhead.display.LevelheadTag
import club.sk1er.mods.levelhead.core.BedwarsModeDetector
import net.minecraft.client.Minecraft
import net.minecraft.client.gui.FontRenderer
import net.minecraft.client.renderer.Tessellator
import net.minecraft.client.renderer.WorldRenderer
import net.minecraft.client.renderer.vertex.DefaultVertexFormats
import net.minecraft.entity.player.EntityPlayer
import net.minecraftforge.client.event.RenderLivingEvent
import net.minecraftforge.fml.common.eventhandler.SubscribeEvent
import org.lwjgl.opengl.GL11

object AboveHeadRender {

    @SubscribeEvent
    fun render(event: RenderLivingEvent.Specials.Post<EntityPlayer>) {
        if (!displayManager.config.enabled) return
        // Previously gated to Hypixel via Essential; if needed, reintroduce via your own server check.
        if (Minecraft.getMinecraft().gameSettings.hideGUI) return
        if (!BedwarsModeDetector.shouldRenderTags()) return

        val player = event.entity

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
        val textScale = 0.016666668f * 1.6f * displayManager.config.fontSize
        GL11.glPushMatrix()
        val mc = Minecraft.getMinecraft()
        val xMultiplier = if (
            mc.gameSettings?.let { it.thirdPersonView == 2 } == true
        ) {
            -1
        } else {
            1
        }
        GL11.glTranslatef(x.toFloat() + 0.0f, y.toFloat() + entityIn.height + 0.5f, z.toFloat())
        GL11.glNormal3f(0.0f, 1.0f, 0.0f)
        val renderManager = mc.renderManager
        GL11.glRotatef(-renderManager.playerViewY, 0.0f, 1.0f, 0.0f)
        GL11.glRotatef(renderManager.playerViewX * xMultiplier, 1.0f, 0.0f, 0.0f)
        GL11.glScalef(-textScale, -textScale, textScale)
        GL11.glDisable(GL11.GL_LIGHTING)
        GL11.glDepthMask(false)
        GL11.glDisable(GL11.GL_DEPTH_TEST)
        GL11.glEnable(GL11.GL_BLEND)
        GL11.glBlendFunc(GL11.GL_SRC_ALPHA, GL11.GL_ONE_MINUS_SRC_ALPHA)
        val stringWidth = fontrenderer.getStringWidth(tag.getString()) shr 1
        val tessellator = Tessellator.instance
        val worldRenderer = tessellator.worldRenderer
        worldRenderer.begin(GL11.GL_QUADS, DefaultVertexFormats.POSITION_COLOR)
        worldRenderer.pos(-stringWidth - 2, -1, 0).color(0.0f, 0.0f, 0.0f, 0.25f).endVertex()
        worldRenderer.pos(-stringWidth - 2, 8, 0).color(0.0f, 0.0f, 0.0f, 0.25f).endVertex()
        worldRenderer.pos(stringWidth + 1, 8, 0).color(0.0f, 0.0f, 0.0f, 0.25f).endVertex()
        worldRenderer.pos(stringWidth + 1, -1, 0).color(0.0f, 0.0f, 0.0f, 0.25f).endVertex()
        tessellator.draw()
        renderString(fontrenderer, tag)
        GL11.glEnable(GL11.GL_LIGHTING)
        GL11.glDisable(GL11.GL_BLEND)
        GL11.glColor4f(1.0f, 1.0f, 1.0f, 1.0f)
        GL11.glPopMatrix()
    }

    private fun renderString(renderer: FontRenderer, tag: LevelheadTag) {
        var x = -(renderer.getStringWidth(tag.getString()) shr 1)
        //Render header
        render(renderer, tag.header, x)
        x += renderer.getStringWidth(tag.header.value)
        //render footer
        render(renderer, tag.footer, x)
    }

    private fun render(renderer: FontRenderer, component: LevelheadTag.LevelheadComponent, x: Int) {
        GL11.glDisable(GL11.GL_DEPTH_TEST)
        GL11.glDepthMask(false)
        if (component.chroma) {
            renderer.drawString(component.value, x, 0, Levelhead.DarkChromaColor)
        } else {
            renderer.drawString(component.value, x, 0, component.color.withAlpha(0.2f).rgb)
        }
        GL11.glEnable(GL11.GL_DEPTH_TEST)
        GL11.glDepthMask(true)
        GL11.glColor3f(1.0f, 1.0f, 1.0f)
        if (component.chroma) {
            renderer.drawString(component.value, x, 0, Levelhead.ChromaColor)
        } else {
            GL11.glColor4f(
                component.color.red / 255f,
                component.color.green / 255f,
                component.color.blue / 255f,
                .5f
            )
            renderer.drawString(component.value, x, 0, component.color.rgb)
        }
    }
}