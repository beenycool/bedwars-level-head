package club.sk1er.mods.levelhead.render

import club.sk1er.mods.levelhead.Levelhead
import club.sk1er.mods.levelhead.Levelhead.displayManager
import club.sk1er.mods.levelhead.config.LevelheadConfig
import club.sk1er.mods.levelhead.core.BedwarsModeDetector
import club.sk1er.mods.levelhead.display.LevelheadTag
import net.minecraft.client.Minecraft
import net.minecraft.client.gui.FontRenderer
import net.minecraft.client.renderer.GlStateManager
import net.minecraft.client.renderer.Tessellator
import net.minecraft.client.renderer.vertex.DefaultVertexFormats
import net.minecraft.entity.player.EntityPlayer
import net.minecraft.util.ResourceLocation
import net.minecraftforge.client.event.RenderWorldLastEvent
import net.minecraftforge.fml.common.eventhandler.SubscribeEvent
import org.lwjgl.opengl.GL11
import java.awt.Color

object AboveHeadRender {

    private const val CUSTOM_ICON_SIZE = 10
    private const val CUSTOM_ICON_SPACING = 2

    @SubscribeEvent
    fun render(event: RenderWorldLastEvent) {
        val minecraft = Minecraft.getMinecraft()
        if (!displayManager.config.enabled) return
        if (!Levelhead.isOnHypixel()) return
        if (minecraft.gameSettings.hideGUI) return
        if (!BedwarsModeDetector.shouldRenderTags()) return
        val world = minecraft.theWorld ?: return
        val localPlayer = minecraft.thePlayer ?: return

        val displays = displayManager.aboveHead.filter { it.config.enabled }
        if (displays.isEmpty()) return

        val customIcon = TextureManager.getCustomIcon()
        val partialTicks = event.partialTicks

        world.playerEntities.forEach { entity ->
            val player = entity as? EntityPlayer ?: return@forEach
            displays.forEachIndexed { index, display ->
                if (!display.loadOrRender(player)) return@forEachIndexed
                if (!display.config.showSelf && player.isSelf(localPlayer)) return@forEachIndexed

                val tag = display.cache[player.uniqueID] ?: return@forEachIndexed
                tag.lastRendered = System.currentTimeMillis()

                var offset = 0.3
                val hasScoreboardObjective = player.worldScoreboard?.getObjectiveInDisplaySlot(2) != null
                val isCloseToLocalPlayer = player.getDistanceSqToEntity(localPlayer) < 100
                if (hasScoreboardObjective && isCloseToLocalPlayer) {
                    offset *= 2
                }
                if (player.isSelf(localPlayer)) {
                    offset = 0.0
                }
                offset += displayManager.config.offset + index * 0.3

                val interpolatedX =
                    player.lastTickPosX + (player.posX - player.lastTickPosX) * partialTicks - minecraft.renderManager.viewerPosX
                val interpolatedY =
                    player.lastTickPosY + (player.posY - player.lastTickPosY) * partialTicks - minecraft.renderManager.viewerPosY
                val interpolatedZ =
                    player.lastTickPosZ + (player.posZ - player.lastTickPosZ) * partialTicks - minecraft.renderManager.viewerPosZ

                renderTag(
                    minecraft,
                    tag,
                    interpolatedX,
                    interpolatedY + player.height + 0.5 + offset,
                    interpolatedZ,
                    customIcon
                )
            }
        }
    }

    private fun EntityPlayer.isSelf(localPlayer: EntityPlayer?): Boolean =
        localPlayer?.uniqueID == this.uniqueID

    private fun renderTag(mc: Minecraft, tag: LevelheadTag, x: Double, y: Double, z: Double, customIcon: ResourceLocation?) {
        val renderer = mc.fontRendererObj
        val scale = (0.016666668f * 1.6f * displayManager.config.fontSize).toFloat()
        GlStateManager.pushMatrix()
        GlStateManager.translate(x, y, z)
        GL11.glNormal3f(0.0f, 1.0f, 0.0f)
        val renderManager = mc.renderManager
        val xMultiplier = if (mc.gameSettings.thirdPersonView == 2) -1 else 1
        GlStateManager.rotate(-renderManager.playerViewY, 0.0f, 1.0f, 0.0f)
        GlStateManager.rotate(renderManager.playerViewX * xMultiplier, 1.0f, 0.0f, 0.0f)
        GlStateManager.scale(-scale, -scale, scale)
        GlStateManager.disableLighting()
        GlStateManager.depthMask(false)
        GlStateManager.disableDepth()
        GlStateManager.enableBlend()
        GlStateManager.tryBlendFuncSeparate(GL11.GL_SRC_ALPHA, GL11.GL_ONE_MINUS_SRC_ALPHA, GL11.GL_ONE, GL11.GL_ZERO)

        val text = tag.getString()
        val textWidth = renderer.getStringWidth(text)
        val shouldRenderIcon = LevelheadConfig.customIconEnabled && customIcon != null
        val iconWidth = if (shouldRenderIcon) CUSTOM_ICON_SIZE else 0
        val spacing = if (shouldRenderIcon && textWidth > 0) CUSTOM_ICON_SPACING else 0
        val totalWidth = textWidth + iconWidth + spacing
        val halfWidth = totalWidth / 2.0

        drawBackground(halfWidth)

        val textStart = (-totalWidth / 2.0 + iconWidth + spacing).toInt()

        if (shouldRenderIcon && customIcon != null) {
            renderCustomIcon(customIcon, -halfWidth, CUSTOM_ICON_SIZE.toDouble())
        }

        renderString(renderer, tag, textStart)

        GlStateManager.enableLighting()
        GlStateManager.disableBlend()
        GlStateManager.color(1f, 1f, 1f, 1f)
        GlStateManager.depthMask(true)
        GlStateManager.enableDepth()
        GlStateManager.popMatrix()
    }

    private fun renderCustomIcon(location: ResourceLocation, left: Double, size: Double) {
        Minecraft.getMinecraft().renderEngine.bindTexture(location)
        GlStateManager.color(1f, 1f, 1f, 1f)
        val halfHeight = size / 2.0
        val right = left + size
        val tessellator = Tessellator.getInstance()
        val buffer = tessellator.worldRenderer
        buffer.begin(GL11.GL_QUADS, DefaultVertexFormats.POSITION_TEX)
        buffer.pos(left, -halfHeight, 0.0).tex(0.0, 0.0).endVertex()
        buffer.pos(left, halfHeight, 0.0).tex(0.0, 1.0).endVertex()
        buffer.pos(right, halfHeight, 0.0).tex(1.0, 1.0).endVertex()
        buffer.pos(right, -halfHeight, 0.0).tex(1.0, 0.0).endVertex()
        tessellator.draw()
    }

    private fun drawBackground(halfWidth: Double) {
        val tessellator = Tessellator.getInstance()
        val buffer = tessellator.worldRenderer
        buffer.begin(GL11.GL_QUADS, DefaultVertexFormats.POSITION_COLOR)
        val left = -halfWidth - 2.0
        val right = halfWidth + 1.0
        buffer.pos(left, -1.0, 0.0).color(0f, 0f, 0f, 0.25f).endVertex()
        buffer.pos(left, 8.0, 0.0).color(0f, 0f, 0f, 0.25f).endVertex()
        buffer.pos(right, 8.0, 0.0).color(0f, 0f, 0f, 0.25f).endVertex()
        buffer.pos(right, -1.0, 0.0).color(0f, 0f, 0f, 0.25f).endVertex()
        tessellator.draw()
    }

    private fun renderString(renderer: FontRenderer, tag: LevelheadTag, startX: Int) {
        var x = startX
        renderComponent(renderer, tag.header, x)
        x += renderer.getStringWidth(tag.header.value)
        renderComponent(renderer, tag.footer, x)
    }

    private fun renderComponent(renderer: FontRenderer, component: LevelheadTag.LevelheadComponent, x: Int) {
        GlStateManager.disableDepth()
        GlStateManager.depthMask(false)
        if (component.chroma) {
            renderer.drawString(component.value, x, 0, Levelhead.DarkChromaColor)
        } else {
            renderer.drawString(component.value, x, 0, component.color.withAlphaFactor(0.2f))
        }
        GlStateManager.enableDepth()
        GlStateManager.depthMask(true)
        if (component.chroma) {
            renderer.drawString(component.value, x, 0, Levelhead.ChromaColor)
        } else {
            renderer.drawString(component.value, x, 0, component.color.rgb)
        }
    }

    private fun Color.withAlphaFactor(alpha: Float): Int {
        val clamped = alpha.coerceIn(0f, 1f)
        val a = (clamped * 255f).toInt().coerceIn(0, 255)
        return Color(red, green, blue, a).rgb
    }
}
