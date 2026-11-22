package club.sk1er.mods.levelhead.render

import club.sk1er.mods.levelhead.Levelhead
import club.sk1er.mods.levelhead.Levelhead.displayManager
import club.sk1er.mods.levelhead.config.MasterConfig
import club.sk1er.mods.levelhead.core.DebugLogging
import club.sk1er.mods.levelhead.core.GameMode
import club.sk1er.mods.levelhead.core.ModeManager
import club.sk1er.mods.levelhead.core.RenderDebug
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
import java.util.Locale

object AboveHeadRender {

    private const val TEXT_SCALE = 0.016666668f * 1.6f

    private const val TAG_LINE_HEIGHT_PIXELS = 9f

    private const val BELOW_NAMETAG_GAP = 0.03f

    private const val ABOVE_HEAD_BASE_OFFSET = 0.3

    private const val STACK_SPACING = 0.3

    private const val MIN_TAG_SCALE = 0.5f
    private const val MAX_TAG_SCALE = 1.5f

    private fun effectiveTagScale(config: MasterConfig): Float {
        val scale = config.tagScale
        return if (scale.isNaN() || scale < MIN_TAG_SCALE || scale > MAX_TAG_SCALE) 1.0f else scale
    }

    private val CHAT_CODE = Regex("§.")

    private fun fmt(value: Float): String = String.format(Locale.ROOT, "%.2f", value)

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

        if (!Levelhead.isOnHypixel()) {
            RenderDebug.logGate("server", "not_hypixel") { "gate server=not_hypixel" }
            return
        }
        val activeMode = ModeManager.getActiveGameMode()
        if (activeMode == null) {
            RenderDebug.logGate("mode", "none") { "gate mode=none" }
            return
        }
        RenderDebug.logGate("mode", activeMode.name) { "gate mode=${activeMode.name}" }

        val player = entity
        val localPlayer = mc.thePlayer
        val isSelf = player.isSelf

        val tagScale = effectiveTagScale(config)

        for (index in displays.indices) {
            val display = displays[index]
            if (!display.config.enabled) continue
            // Keep the second isSelf call: PolyNametag redirects ordinal 1 to apply
            // its show-own-nametag setting.
            if (player.isSelf && !display.config.showSelf) continue
            if (!display.loadOrRender(player)) continue

            val stats = Levelhead.getCachedStats(entity.uniqueID, activeMode) ?: continue

            val hasBelowNameLine = localPlayer != null &&
                player.worldScoreboard.getObjectiveInDisplaySlot(2) != null &&
                player.getDistanceSqToEntity(localPlayer) < 100.0

            var anchoredOffset = ABOVE_HEAD_BASE_OFFSET * tagScale
            if (hasBelowNameLine) {
                anchoredOffset *= 2
            }
            anchoredOffset += config.offset

            val tag = TagFormatter.formatTag(
                player.uniqueID,
                stats,
                display.config,
                activeMode,
                statsVersion = Levelhead.statsStore.version(entity.uniqueID, activeMode)
            )
            val stacking = index * STACK_SPACING * tagScale
            renderName(
                tag,
                player,
                event.x,
                event.y,
                event.z,
                aboveHeadOffset = anchoredOffset + stacking,
                belowOffset = config.offset + stacking,
                tagScale = tagScale,
                gameMode = activeMode,
                isSelf = isSelf,
                hasBelowNameLine = hasBelowNameLine
            )
        }
    }

    private fun renderName(
        tag: LevelheadTag,
        entityIn: EntityPlayer,
        x: Double,
        y: Double,
        z: Double,
        aboveHeadOffset: Double,
        belowOffset: Double,
        tagScale: Float,
        gameMode: GameMode,
        isSelf: Boolean,
        hasBelowNameLine: Boolean
    ) {
        // An empty tag with the background enabled would draw a bare 3x9 box.
        if (tag.getString().isBlank()) return

        val mc = Minecraft.getMinecraft()
        val fontRenderer = mc.fontRendererObj
        val config = displayManager.config

        val textScale = TEXT_SCALE * tagScale
        val lineHeightBlocks = TAG_LINE_HEIGHT_PIXELS * textScale
        // The below drop already accounts for the vanilla below-name line lift, so
        // the subtracted offset must not be doubled like the above-head slot anchor.
        // The server's own below-name line still needs one extra line of clearance.
        val slotTwoDrop = if (hasBelowNameLine) TAG_LINE_HEIGHT_PIXELS * textScale else 0f
        val belowNametagDrop = lineHeightBlocks + BELOW_NAMETAG_GAP + slotTwoDrop

        val vanillaAnchorY = y.toFloat() + entityIn.height + 0.5f
        val renderY = when (config.displayPosition) {
            MasterConfig.DisplayPosition.ABOVE -> vanillaAnchorY + aboveHeadOffset.toFloat()
            MasterConfig.DisplayPosition.BELOW ->
                vanillaAnchorY - belowNametagDrop - belowOffset.toFloat()
        }

        val header = tag.header
        val footer = tag.footer

        val halfWidth = fontRenderer.getStringWidth(tag.getString()) shr 1

        val view = mc.gameSettings?.thirdPersonView ?: 0
        val maskedUuid = with(DebugLogging) { entityIn.uniqueID.maskForLogs() }
        RenderDebug.logTag(
            key = "tag:${entityIn.uniqueID}",
            signature = "${config.displayPosition}|$view|${config.showBackground}|" +
                "${config.backgroundOpacity}|$tagScale|${tag.getString()}",
            message = {
                val loggedOffset =
                    if (config.displayPosition == MasterConfig.DisplayPosition.ABOVE) aboveHeadOffset else belowOffset
                val text = tag.getString().replace(CHAT_CODE, "")
                "player=${entityIn.name} uuid=$maskedUuid self=$isSelf mode=${gameMode.name} " +
                    "pos=${config.displayPosition} view=$view " +
                    "yaw=${fmt(mc.renderManager.playerViewY)} pitch=${fmt(mc.renderManager.playerViewX)} " +
                    "scale=${fmt(textScale)} tagScale=${fmt(tagScale)} offset=${fmt(loggedOffset.toFloat())} " +
                    "anchor=${fmt(vanillaAnchorY)} renderY=${fmt(renderY)} " +
                    "width=${fontRenderer.getStringWidth(tag.getString())} " +
                    "bg=${config.showBackground} alpha=${fmt(config.backgroundOpacity)} text='$text'"
            }
        )

        GlStateManager.pushMatrix()
        try {
            GlStateManager.translate(x.toFloat(), renderY, z.toFloat())
            GL11.glNormal3f(0.0f, 1.0f, 0.0f)
            val renderManager = mc.renderManager
            GlStateManager.rotate(-renderManager.playerViewY, 0.0f, 1.0f, 0.0f)
            GlStateManager.rotate(renderManager.playerViewX, 1.0f, 0.0f, 0.0f)
            GlStateManager.scale(-textScale, -textScale, textScale)

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
            drawComponent(fontRenderer, header, textX)
            textX += fontRenderer.getStringWidth(header.value)
            drawComponent(fontRenderer, footer, textX)
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
        worldRenderer.pos((-halfWidth - 1).toDouble(), -1.0, 0.0).color(0.0f, 0.0f, 0.0f, alpha).endVertex()
        worldRenderer.pos((-halfWidth - 1).toDouble(), 8.0, 0.0).color(0.0f, 0.0f, 0.0f, alpha).endVertex()
        worldRenderer.pos((halfWidth + 1).toDouble(), 8.0, 0.0).color(0.0f, 0.0f, 0.0f, alpha).endVertex()
        worldRenderer.pos((halfWidth + 1).toDouble(), -1.0, 0.0).color(0.0f, 0.0f, 0.0f, alpha).endVertex()
        tessellator.draw()
        GlStateManager.enableTexture2D()
        GlStateManager.enableDepth()
        GlStateManager.depthMask(true)
    }

    /**
     * PolyNametag redirects the int drawString calls in this method to apply its
     * Text Type (No Shadow / Shadow / Full Shadow). Above-head text no longer goes
     * through here, so PolyNametag cannot restyle it, but the name and signature
     * must stay stable or that mixin fails to apply.
     */
    @Suppress("unused")
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
     * Same two passes as the vanilla nametag: a 12.5% copy with depth testing off,
     * then the solid copy with depth testing on. The float overload keeps this out
     * of PolyNametag's int-overload redirect, and the drop shadow is never enabled.
     */
    private fun drawComponent(renderer: FontRenderer, component: LevelheadTag.LevelheadComponent, x: Int) {
        if (component.value.isEmpty()) return
        val faintColor = (component.color.rgb and 0xFFFFFF) or 0x20000000
        GlStateManager.disableDepth()
        GlStateManager.depthMask(false)
        renderer.drawString(component.value, x.toFloat(), 0.0f, faintColor, false)
        GlStateManager.enableDepth()
        GlStateManager.depthMask(true)
        GlStateManager.color(1.0f, 1.0f, 1.0f, 1.0f)
        renderer.drawString(component.value, x.toFloat(), 0.0f, component.color.rgb, false)
    }

    private val EntityPlayer.isSelf: Boolean
        get() = Minecraft.getMinecraft()?.thePlayer?.uniqueID == uniqueID
}
