package club.sk1er.mods.levelhead.render

import club.sk1er.mods.levelhead.Levelhead
import club.sk1er.mods.levelhead.Levelhead.displayManager
import club.sk1er.mods.levelhead.config.MasterConfig
import club.sk1er.mods.levelhead.core.ModeManager
import club.sk1er.mods.levelhead.core.NametagShadowCompat
import club.sk1er.mods.levelhead.core.TagFormatter
import club.sk1er.mods.levelhead.display.LevelheadTag
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

    private const val TAG_LINE_HEIGHT_BLOCKS = 9f * 0.016666668f * 1.6f

    private const val BELOW_NAMETAG_GAP = 0.03f

    private const val BELOW_NAMETAG_DROP = TAG_LINE_HEIGHT_BLOCKS + BELOW_NAMETAG_GAP

    private const val TEXT_SCALE = 0.016666668f * 1.6f

    @SubscribeEvent
    fun render(event: RenderLivingEvent.Specials.Post<EntityLivingBase>) {
        // B25: reject the entity type before touching Minecraft, config or displays,
        // and before allocating anything. Armour stands / holograms never get past here.
        val entity = event.entity
        if (entity !is EntityPlayer) return

        val mc = Minecraft.getMinecraft()
        val gameSettings = mc.gameSettings ?: return
        if (gameSettings.hideGUI) return

        val config = displayManager.config
        if (!config.enabled) return

        val displays = displayManager.aboveHead
        if (displays.isEmpty()) return

        if (!Levelhead.isOnHypixel()) return
        val activeMode = ModeManager.getActiveGameMode() ?: return
        val stats = Levelhead.getCachedStats(entity.uniqueID, activeMode) ?: return
        val statsVersion = Levelhead.statsStore.version(entity.uniqueID, activeMode)

        val player = entity
        val localPlayer = mc.thePlayer
        val isSelf = player.isSelf
        val polyNametag = NametagShadowCompat.polyNametagActive
        val textShadow = if (polyNametag) false else (NametagShadowCompat.patcherTextShadow() ?: config.textShadow)

        val anchoredOffset = if (isSelf) {
            config.offset
        } else {
            var offset = 0.3
            if (localPlayer != null &&
                player.worldScoreboard.getObjectiveInDisplaySlot(2) != null &&
                player.getDistanceSqToEntity(localPlayer) < 100.0
            ) {
                offset *= 2
            }
            offset + config.offset
        }

        var index = 0
        while (index < displays.size) {
            val display = displays[index]
            // Keep the second isSelf call: PolyNametag redirects ordinal 1 to apply
            // its show-own-nametag setting.
            if (display.config.enabled &&
                !(player.isSelf && !display.config.showSelf)
            ) {
                val tag = TagFormatter.formatTag(
                    player.uniqueID,
                    stats,
                    display.config,
                    activeMode,
                    statsVersion = statsVersion
                )
                if (display.loadOrRender(player)) {
                    val offset = anchoredOffset + index * 0.3
                    renderName(tag, player, event.x, event.y, event.z, offset, textShadow, polyNametag)
                }
            }
            index++
        }
    }

    private fun renderName(
        tag: LevelheadTag,
        entityIn: EntityPlayer,
        x: Double,
        y: Double,
        z: Double,
        verticalOffset: Double,
        textShadow: Boolean,
        polyNametag: Boolean
    ) {
        val mc = Minecraft.getMinecraft()
        val fontRenderer = mc.fontRendererObj
        val config = displayManager.config

        val vanillaAnchorY = y.toFloat() + entityIn.height + 0.5f
        val renderY = when (config.displayPosition) {
            MasterConfig.DisplayPosition.ABOVE -> vanillaAnchorY + verticalOffset.toFloat()
            MasterConfig.DisplayPosition.BELOW ->
                vanillaAnchorY - BELOW_NAMETAG_DROP - verticalOffset.toFloat()
        }

        val header = tag.header
        val footer = tag.footer

        val halfWidth = fontRenderer.getStringWidth(tag.getString()) shr 1

        GlStateManager.pushMatrix()
        try {
            GlStateManager.translate(x.toFloat(), renderY, z.toFloat())
            GL11.glNormal3f(0.0f, 1.0f, 0.0f)
            val renderManager = mc.renderManager
            val viewXMultiplier = if (mc.gameSettings != null && mc.gameSettings.thirdPersonView == 2) -1f else 1f
            GlStateManager.rotate(-renderManager.playerViewY, 0.0f, 1.0f, 0.0f)
            GlStateManager.rotate(renderManager.playerViewX * viewXMultiplier, 1.0f, 0.0f, 0.0f)
            GlStateManager.scale(-TEXT_SCALE, -TEXT_SCALE, TEXT_SCALE)

            GlStateManager.disableLighting()
            GlStateManager.depthMask(false)
            GlStateManager.enableBlend()
            GlStateManager.tryBlendFuncSeparate(
                GL11.GL_SRC_ALPHA, GL11.GL_ONE_MINUS_SRC_ALPHA, GL11.GL_ONE, GL11.GL_ZERO
            )

            if (config.showBackground) {
                drawBackground(halfWidth, config.backgroundOpacity)
            }

            var textX = -halfWidth
            if (polyNametag) {
                render(fontRenderer, header, textX)
            } else {
                renderComponent(fontRenderer, header.value, header.color, textX, textShadow)
            }
            textX += fontRenderer.getStringWidth(header.value)
            if (polyNametag) {
                render(fontRenderer, footer, textX)
            } else {
                renderComponent(fontRenderer, footer.value, footer.color, textX, textShadow)
            }
        } finally {
            GlStateManager.enableTexture2D()
            GlStateManager.enableDepth()
            GlStateManager.depthMask(true)
            GlStateManager.enableLighting()
            GlStateManager.disableBlend()
            GlStateManager.color(1.0f, 1.0f, 1.0f, 1.0f)
            GlStateManager.popMatrix()
        }
    }

    private fun drawBackground(halfWidth: Int, alpha: Float) {
        GlStateManager.disableDepth()
        GlStateManager.depthMask(false)
        GlStateManager.disableTexture2D()
        val tessellator = Tessellator.getInstance()
        val worldRenderer = tessellator.worldRenderer
        worldRenderer.begin(GL11.GL_QUADS, DefaultVertexFormats.POSITION_COLOR)
        worldRenderer.pos((-halfWidth - 2).toDouble(), -1.0, 0.0).color(0.0f, 0.0f, 0.0f, alpha).endVertex()
        worldRenderer.pos((-halfWidth - 2).toDouble(), 8.0, 0.0).color(0.0f, 0.0f, 0.0f, alpha).endVertex()
        worldRenderer.pos((halfWidth + 1).toDouble(), 8.0, 0.0).color(0.0f, 0.0f, 0.0f, alpha).endVertex()
        worldRenderer.pos((halfWidth + 1).toDouble(), -1.0, 0.0).color(0.0f, 0.0f, 0.0f, alpha).endVertex()
        tessellator.draw()
        GlStateManager.enableTexture2D()
        GlStateManager.enableDepth()
        GlStateManager.depthMask(true)
    }

    /**
     * PolyNametag redirects the int drawString calls in this method to apply its
     * Text Type (No Shadow / Shadow / Full Shadow). Keep this name and signature
     * stable so that mixin keeps applying.
     */
    private fun render(renderer: FontRenderer, component: LevelheadTag.LevelheadComponent, x: Int) {
        if (component.value.isEmpty()) return
        GlStateManager.disableDepth()
        GlStateManager.depthMask(false)
        val faintColor = (component.color.rgb and 0xFFFFFF) or (0x33 shl 24)
        renderer.drawString(component.value, x, 0, faintColor)
        GlStateManager.enableDepth()
        GlStateManager.depthMask(true)
        GlStateManager.color(1.0f, 1.0f, 1.0f, 1.0f)
        renderer.drawString(component.value, x, 0, component.color.rgb)
    }

    /**
     * Fallback draw for setups without PolyNametag: the faint see-through copy and
     * the normal drop shadow follow the effective shadow setting.
     */
    private fun renderComponent(
        fontRenderer: FontRenderer,
        text: String,
        color: Color,
        x: Int,
        textShadow: Boolean
    ) {
        if (text.isEmpty()) return
        if (textShadow) {
            GlStateManager.disableDepth()
            GlStateManager.depthMask(false)
            val faintColor = (color.rgb and 0xFFFFFF) or (0x33 shl 24)
            fontRenderer.drawString(text, x.toFloat(), 0.0f, faintColor, false)
            GlStateManager.enableDepth()
            GlStateManager.depthMask(true)
            GlStateManager.color(1.0f, 1.0f, 1.0f, 1.0f)
        }
        GlStateManager.enableDepth()
        GlStateManager.depthMask(true)
        fontRenderer.drawString(text, x.toFloat(), 0.0f, color.rgb, textShadow)
    }

    private val EntityPlayer.isSelf: Boolean
        get() = Minecraft.getMinecraft()?.thePlayer?.uniqueID == uniqueID
}
