package club.sk1er.mods.levelhead.render

import club.sk1er.mods.levelhead.Levelhead
import club.sk1er.mods.levelhead.Levelhead.displayManager
import club.sk1er.mods.levelhead.config.LevelheadConfig
import club.sk1er.mods.levelhead.config.MasterConfig
import club.sk1er.mods.levelhead.display.LevelheadTag
import club.sk1er.mods.levelhead.core.DebugLogging
import club.sk1er.mods.levelhead.core.DebugLogging.formatAsHex
import club.sk1er.mods.levelhead.core.DebugLogging.logRenderDebug
import club.sk1er.mods.levelhead.core.DebugLogging.maskForLogs
import club.sk1er.mods.levelhead.core.DebugLogging.truncateForLogs
import club.sk1er.mods.levelhead.core.ModeManager
import club.sk1er.mods.levelhead.core.PerformanceMetrics
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
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

object AboveHeadRender {
    private var nextSelfSkipLogAt: Long = 0L
    private val nextRenderDebugLogAt = ConcurrentHashMap<UUID, Long>()

    private const val TEXT_SCALE = 0.016666668f * 1.6f
    private const val RENDER_LOG_INTERVAL_MS = 2000L
    private const val SEE_THROUGH_TEXT_ALPHA = 0.2f
    private const val OPAQUE_TEXT_ALPHA = 1.0f
    private const val SEE_THROUGH_SHADOW_ALPHA = 51
    private const val OPAQUE_SHADOW_ALPHA = 255
    private val SEE_THROUGH_SHADOW_COLOR = java.awt.Color(0, 0, 0, SEE_THROUGH_SHADOW_ALPHA).rgb
    private val OPAQUE_SHADOW_COLOR = java.awt.Color(0, 0, 0, OPAQUE_SHADOW_ALPHA).rgb

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

        // Hoist activeMode lookup outside the loop to avoid redundant calls
        val activeMode = ModeManager.getActiveGameMode()

        displayManager.aboveHead.forEachIndexed { index, display ->
            if (!display.config.enabled) return@forEachIndexed
            if (isInventoryScreen && player.isSelf && !LevelheadConfig.showInInventory) {
                return@forEachIndexed
            }
            if (player.isSelf && !display.config.showSelf) {
                maybeLogSelfHidden(displayPosition)
                return@forEachIndexed
            }
            // Look up tag by (uuid, activeMode) to ensure mode-specific tags are served
            // When activeMode is null, tags are not rendered (intentional behavior)
            val tag = if (activeMode != null) {
                display.cache[Levelhead.DisplayCacheKey(player.uniqueID, activeMode)]
            } else {
                null
            }
            if (display.loadOrRender(player) && tag != null) {
                tag.lastSeen = System.currentTimeMillis()
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

                // Render sampling debug logging (throttled per player)
                logRenderSamplingIfEnabled(tag, player.uniqueID, player.name, displayPosition, offset + indexOffset)

                PerformanceMetrics.recordTagRender()
                renderName(tag, player, event.x, event.y + offset + indexOffset, event.z)
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

    private fun logRenderSamplingIfEnabled(
        tag: LevelheadTag,
        playerUuid: UUID,
        playerName: String,
        displayPosition: MasterConfig.DisplayPosition,
        yOffset: Double
    ) {
        if (!DebugLogging.isRenderDebugEnabled()) {
            return
        }
        val now = System.currentTimeMillis()
        val nextLogAt = nextRenderDebugLogAt.getOrDefault(playerUuid, 0L)
        if (now < nextLogAt) {
            return
        }
        nextRenderDebugLogAt[playerUuid] = now + RENDER_LOG_INTERVAL_MS

        DebugLogging.logRenderDebug {
            val maskedUuid = playerUuid.maskForLogs()
            val tagString = tag.getString().truncateForLogs(200)
            val headerValue = tag.header.value.truncateForLogs(100)
            val footerValue = tag.footer.value.truncateForLogs(100)
            val headerColor = tag.header.color.formatAsHex()
            val footerColor = tag.footer.color.formatAsHex()
            val offsetFormatted = String.format(java.util.Locale.ROOT, "%.2f", yOffset)
            val backgroundOpacity = String.format(java.util.Locale.ROOT, "%.2f", displayManager.config.backgroundOpacity)

            "[LevelheadDebug][render] player=${playerName} uuid=${maskedUuid} tag=\"${tagString}\" " +
                "header=\"${headerValue}\" headerColor=${headerColor} " +
                "footer=\"${footerValue}\" footerColor=${footerColor} " +
                "position=${displayPosition} yOffset=${offsetFormatted} " +
                "shadow=${displayManager.config.textShadow} background=${displayManager.config.showBackground} " +
                "backgroundOpacity=${backgroundOpacity} textAlpha=${SEE_THROUGH_TEXT_ALPHA}/${OPAQUE_TEXT_ALPHA}"
        }
    }

    fun clearRenderDebugState() {
        nextRenderDebugLogAt.clear()
    }

    private val EntityPlayer.isSelf: Boolean
        get() = UPlayer.getUUID() == this.uniqueID

    private fun renderName(tag: LevelheadTag, entityIn: EntityPlayer, x: Double, y: Double, z: Double) {
        val fontrenderer = getFontRenderer()
        val textScale = TEXT_SCALE
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
        val stringWidth = tag.getTotalWidth(fontrenderer) shr 1
        if (displayManager.config.showBackground) {
            val bgAlpha = displayManager.config.backgroundOpacity
            val uGraphics = UGraphics.getFromTessellator().beginWithDefaultShader(UGraphics.DrawMode.QUADS, DefaultVertexFormats.POSITION_COLOR)
            uGraphics.pos(UMatrixStack.Compat.get(), (-stringWidth - 2).toDouble(), -1.0, 0.01).color(0.0f, 0.0f, 0.0f, bgAlpha).endVertex()
            uGraphics.pos(UMatrixStack.Compat.get(), (-stringWidth - 2).toDouble(), 8.0, 0.01).color(0.0f, 0.0f, 0.0f, bgAlpha).endVertex()
            uGraphics.pos(UMatrixStack.Compat.get(), (stringWidth + 2).toDouble(), 8.0, 0.01).color(0.0f, 0.0f, 0.0f, bgAlpha).endVertex()
            uGraphics.pos(UMatrixStack.Compat.get(), (stringWidth + 2).toDouble(), -1.0, 0.01).color(0.0f, 0.0f, 0.0f, bgAlpha).endVertex()
            uGraphics.drawDirect()
        }
        renderString(fontrenderer, tag, displayManager.config.textShadow, stringWidth)
        UGraphics.enableLighting()
        UGraphics.disableBlend()
        UGraphics.color4f(1.0f, 1.0f, 1.0f, 1.0f)
        UGraphics.GL.popMatrix()
    }

    private fun renderString(renderer: FontRenderer, tag: LevelheadTag, shadow: Boolean, stringWidthHalf: Int) {
        val x = -stringWidthHalf

        val headerComp = tag.header
        val footerComp = tag.footer
        val headerWidth = headerComp.getWidth(renderer)

        // Pass 1: See-through (no depth)
        UGraphics.disableDepth()
        UGraphics.depthMask(false)
        renderComponent(renderer, headerComp, x, shadow, true)
        renderComponent(renderer, footerComp, x + headerWidth, shadow, true)

        // Pass 2: Opaque (with depth)
        UGraphics.enableDepth()
        UGraphics.depthMask(true)
        UGraphics.directColor3f(1.0f, 1.0f, 1.0f)
        UGraphics.GL.translate(0f, 0f, -0.01f)
        renderComponent(renderer, headerComp, x, shadow, false)
        renderComponent(renderer, footerComp, x + headerWidth, shadow, false)
        UGraphics.GL.translate(0f, 0f, 0.01f)
    }

    private fun renderComponent(renderer: FontRenderer, component: LevelheadTag.LevelheadComponent, x: Int, shadow: Boolean, seeThrough: Boolean) {
        if (shadow) {
            val cleanText = net.minecraft.util.StringUtils.stripControlCodes(component.value)
            val shadowColor = if (seeThrough) SEE_THROUGH_SHADOW_COLOR else OPAQUE_SHADOW_COLOR
            renderer.drawString(cleanText, x + 1, 1, shadowColor)
        }

        val textAlpha = if (seeThrough) SEE_THROUGH_TEXT_ALPHA else OPAQUE_TEXT_ALPHA
        val textColor = component.color.withAlpha(textAlpha).rgb
        renderer.drawString(component.value, x, 0, textColor)
    }
}
