package club.sk1er.mods.levelhead.render

import club.sk1er.mods.levelhead.Levelhead
import club.sk1er.mods.levelhead.Levelhead.displayManager
import club.sk1er.mods.levelhead.config.LevelheadConfig
import club.sk1er.mods.levelhead.config.MasterConfig
import club.sk1er.mods.levelhead.display.LevelheadTag
import club.sk1er.mods.levelhead.core.ModeManager
import gg.essential.api.EssentialAPI
import gg.essential.elementa.utils.withAlpha
import gg.essential.universal.UGraphics
import gg.essential.universal.UMatrixStack
import gg.essential.universal.UMinecraft
import gg.essential.universal.UMinecraft.getFontRenderer
import gg.essential.universal.UMinecraft.getMinecraft
import gg.essential.universal.wrappers.UPlayer
import net.minecraft.client.gui.inventory.GuiInventory
import net.minecraft.client.gui.FontRenderer
import net.minecraft.client.renderer.vertex.DefaultVertexFormats
import net.minecraft.entity.EntityLivingBase
import net.minecraft.entity.player.EntityPlayer
import net.minecraftforge.client.event.RenderLivingEvent
import net.minecraftforge.fml.common.eventhandler.SubscribeEvent
import org.lwjgl.opengl.GL11

object AboveHeadRender {
    private var nextSelfSkipLogAt: Long = 0L

    @SubscribeEvent
    fun render(event: RenderLivingEvent.Specials.Post<EntityLivingBase>) {
        if (!displayManager.config.enabled) return
        if (!EssentialAPI.getMinecraftUtil().isHypixel()) return
        if (getMinecraft().gameSettings.hideGUI) return
        if (!ModeManager.shouldRenderTags()) return

        if (event.entity !is EntityPlayer) return
        val player = event.entity as EntityPlayer

        val localPlayer = UMinecraft.getPlayer()
        val displayPosition = displayManager.config.displayPosition
        val isInventoryScreen = getMinecraft().currentScreen is GuiInventory

        displayManager.aboveHead.forEachIndexed { index, display ->
            if (!display.config.enabled) return@forEachIndexed
            if (isInventoryScreen && player.isSelf && !LevelheadConfig.showInInventory) {
                return@forEachIndexed
            }
            if (player.isSelf && !display.config.showSelf) {
                maybeLogSelfHidden(displayPosition)
                return@forEachIndexed
            }
            val tag = display.cache[player.uniqueID]
            if (display.loadOrRender(player) && tag != null) {
                // Calculate base offset based on display position
                var offset = when (displayPosition) {
                    MasterConfig.DisplayPosition.ABOVE -> 0.3
                    MasterConfig.DisplayPosition.BELOW -> -0.1
                }
                
                val hasScoreboardObjective = player.worldScoreboard?.getObjectiveInDisplaySlot(2) != null
                val isCloseToLocalPlayer = localPlayer?.let { player.getDistanceSqToEntity(it) < 100 } ?: false
                
                // Adjust offset for scoreboard when displaying above
                if (displayPosition == MasterConfig.DisplayPosition.ABOVE && hasScoreboardObjective && isCloseToLocalPlayer) {
                    offset *= 2
                }
                
                offset += displayManager.config.offset
                
                // Adjust index offset direction based on position
                val indexOffset = when (displayPosition) {
                    MasterConfig.DisplayPosition.ABOVE -> index * 0.3
                    MasterConfig.DisplayPosition.BELOW -> -(index * 0.3)
                }
                
                renderName(tag, player, event.x, event.y + offset + indexOffset, event.z, displayPosition)
            }
        }
    }

    private fun maybeLogSelfHidden(displayPosition: MasterConfig.DisplayPosition) {
        if (!LevelheadConfig.debugConfigSync) {
            return
        }
        val now = System.currentTimeMillis()
        if (now < nextSelfSkipLogAt) {
            return
        }
        nextSelfSkipLogAt = now + 2000L
        Levelhead.logger.info(
            "[LevelheadRender] skipping self tag (showSelf=false, displayPosition={}, offset={})",
            displayPosition,
            String.format(java.util.Locale.ROOT, "%.2f", displayManager.config.offset)
        )
    }

    private val EntityPlayer.isSelf: Boolean
        get() = UPlayer.getUUID() == this.uniqueID

    private fun renderName(tag: LevelheadTag, entityIn: EntityPlayer, x: Double, y: Double, z: Double, displayPosition: MasterConfig.DisplayPosition) {
        val fontrenderer = getFontRenderer()
        val textScale = 0.016666668f * 1.6f * displayManager.config.fontSize
        UGraphics.GL.pushMatrix()
        val mc = getMinecraft()
        val xMultiplier = if (
            mc.gameSettings?.let { it.thirdPersonView == 2 } == true
        ) {
            -1
        } else {
            1
        }
        
        // The y parameter already includes the direction for ABOVE/BELOW. Offset from the player's head.
        val yOffset = entityIn.height + 0.5f

        UGraphics.GL.translate(x.toFloat() + 0.0f, y.toFloat() + yOffset, z.toFloat())
        GL11.glNormal3f(0.0f, 1.0f, 0.0f)
        val renderManager = mc.renderManager
        UGraphics.GL.rotate(-renderManager.playerViewY, 0.0f, 1.0f, 0.0f)
        UGraphics.GL.rotate(renderManager.playerViewX * xMultiplier, 1.0f, 0.0f, 0.0f)
        UGraphics.GL.scale(-textScale, -textScale, textScale)
        UGraphics.disableLighting()
        UGraphics.depthMask(false)
        UGraphics.disableDepth()
        UGraphics.enableBlend()
        UGraphics.tryBlendFuncSeparate(GL11.GL_SRC_ALPHA, GL11.GL_ONE_MINUS_SRC_ALPHA, GL11.GL_ONE, GL11.GL_ZERO)
        val stringWidth = fontrenderer.getStringWidth(tag.getString()) shr 1
        val uGraphics = UGraphics.getFromTessellator().beginWithDefaultShader(UGraphics.DrawMode.QUADS, DefaultVertexFormats.POSITION_COLOR)
        uGraphics.pos(UMatrixStack.Compat.get(), (-stringWidth - 2).toDouble(), -1.0, 0.0).color(0.0f, 0.0f, 0.0f, 0.25f).endVertex()
        uGraphics.pos(UMatrixStack.Compat.get(), (-stringWidth - 2).toDouble(), 8.0, 0.0).color(0.0f, 0.0f, 0.0f, 0.25f).endVertex()
        uGraphics.pos(UMatrixStack.Compat.get(), (stringWidth + 1).toDouble(), 8.0, 0.0).color(0.0f, 0.0f, 0.0f, 0.25f).endVertex()
        uGraphics.pos(UMatrixStack.Compat.get(), (stringWidth + 1).toDouble(), -1.0, 0.0).color(0.0f, 0.0f, 0.0f, 0.25f).endVertex()
        uGraphics.drawDirect()
        renderString(fontrenderer, tag)
        UGraphics.enableLighting()
        UGraphics.disableBlend()
        UGraphics.color4f(1.0f, 1.0f, 1.0f, 1.0f)
        UGraphics.GL.popMatrix()
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
        UGraphics.disableDepth()
        UGraphics.depthMask(false)
        renderer.drawString(component.value, x, 0, component.color.withAlpha(0.2f).rgb)
        UGraphics.enableDepth()
        UGraphics.depthMask(true)
        UGraphics.directColor3f(1.0f, 1.0f, 1.0f)
        UGraphics.color4f(
            component.color.red / 255f,
            component.color.green / 255f,
            component.color.blue / 255f,
            .5f
        )
        renderer.drawString(component.value, x, 0, component.color.rgb)
    }
}
