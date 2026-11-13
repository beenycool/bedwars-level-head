package club.sk1er.mods.levelhead.render

import club.sk1er.mods.levelhead.Levelhead
import club.sk1er.mods.levelhead.Levelhead.displayManager
import club.sk1er.mods.levelhead.config.MasterConfig
import club.sk1er.mods.levelhead.core.ModeManager
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

/**
 * Draws the stats tag above (or below) a player's vanilla nametag.
 *
 * Everything here is plain vanilla 1.8.9 rendering: [GlStateManager], [Tessellator]
 * and [FontRenderer]. No Essential / UniversalCraft / Elementa classes are used, so
 * the jar renders on Forge alone (B27).
 *
 * State discipline follows `Render.renderLivingLabel` (see the end of [renderName]):
 * depth test, depth mask, texture2D, blend and lighting are always restored, whether
 * or not any optional branch ran (B22).
 */
object AboveHeadRender {

    /**
     * Height of one line of nametag text in blocks at the scale used here.
     *
     * Derivation (1.8.9): vanilla renders nametags at
     * `GlStateManager.scale(-0.02666667F, -0.02666667F, 0.02666667F)` (1/37.5) and
     * draws the background quad from text-space y = -1 to y = 8, i.e. 9 px tall.
     * Our tag uses the same scale (textScale = 0.016666668 * 1.6 = 0.02666667), so
     * the tag block is 9 * 0.02666667 = 0.24 blocks tall.
     */
    private const val TAG_LINE_HEIGHT_BLOCKS = 9f * 0.016666668f * 1.6f

    /** Small gap between the vanilla nametag block and a BELOW-position tag. */
    private const val BELOW_NAMETAG_GAP = 0.03f

    /**
     * Distance from the vanilla nametag anchor to the BELOW-position translate point:
     * clear the full vanilla nametag block (0.24) plus [BELOW_NAMETAG_GAP].
     */
    private const val BELOW_NAMETAG_DROP = TAG_LINE_HEIGHT_BLOCKS + BELOW_NAMETAG_GAP

    /** 1 / 37.5, the vanilla nametag scale. */
    private const val TEXT_SCALE = 0.016666668f * 1.6f

    /** Vanilla's see-through label pass colour (white, alpha 0x20). */
    private const val SEE_THROUGH_TEXT_COLOR = 0x20FFFFFF

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

        // Per-entity invariants: resolved once for the whole display loop.
        if (!Levelhead.isOnHypixel()) return
        val activeMode = ModeManager.getActiveGameMode() ?: return
        // No stats is absence: render nothing rather than a "?" tag.
        val stats = Levelhead.getCachedStats(entity.uniqueID, activeMode) ?: return
        val statsVersion = Levelhead.statsStore.version(entity.uniqueID, activeMode)

        val player = entity
        val localPlayer = mc.thePlayer
        val isSelf = localPlayer != null && localPlayer.uniqueID == player.uniqueID

        // Vertical distance from the vanilla nametag anchor. `y` below already carries
        // this, so BELOW mode must not add it a second time (B24).
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
            // B25: a missing tag is the common case in a hub; resolve the boolean
            // checks before loadOrRender builds display names.
            if (display.config.enabled &&
                !(isSelf && !display.config.showSelf)
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
                    renderName(tag, player, event.x, event.y + offset, event.z, offset)
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
        aboveHeadOffset: Double
    ) {
        val mc = Minecraft.getMinecraft()
        val fontRenderer = mc.fontRendererObj
        val config = displayManager.config

        // `y` is positioned for ABOVE mode. BELOW mode anchors to the vanilla nametag
        // block and then drops by the same distance, in the same direction as ABOVE
        // grows, so the offset slider keeps working once and stacked displays separate.
        val vanillaAnchorY = y.toFloat() + entityIn.height + 0.5f
        val renderY = when (config.displayPosition) {
            MasterConfig.DisplayPosition.ABOVE -> vanillaAnchorY
            MasterConfig.DisplayPosition.BELOW ->
                vanillaAnchorY - BELOW_NAMETAG_DROP - aboveHeadOffset.toFloat()
        }

        // StatsFormatter already emits the prestige-aware star tag, including its
        // inline `§` colour codes, so both components are drawn exactly as stored.
        val header = tag.header
        val footer = tag.footer
        val footerText = footer.value

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
            GlStateManager.disableDepth()
            GlStateManager.enableBlend()
            GlStateManager.tryBlendFuncSeparate(
                GL11.GL_SRC_ALPHA, GL11.GL_ONE_MINUS_SRC_ALPHA, GL11.GL_ONE, GL11.GL_ZERO
            )

            val headerWidth = fontRenderer.getStringWidth(header.value)
            val totalWidth = headerWidth + fontRenderer.getStringWidth(footerText)
            val left = -(totalWidth shr 1)

            if (config.showBackground) {
                drawBackground(left, totalWidth, config.backgroundOpacity)
            }

            drawComponent(fontRenderer, header.value, header.color, left, config.textShadow)
            drawComponent(
                fontRenderer,
                footerText,
                footer.color,
                left + headerWidth,
                config.textShadow
            )
        } finally {
            // B22/B23: leave the GL state exactly as vanilla's Render.renderLivingLabel
            // leaves it, on every path. Previously depth test and depth mask stayed
            // disabled when "Text Shadow" was off, so every later entity drew through
            // walls.
            GlStateManager.enableTexture2D()
            GlStateManager.enableDepth()
            GlStateManager.depthMask(true)
            GlStateManager.enableLighting()
            GlStateManager.disableBlend()
            GlStateManager.color(1.0f, 1.0f, 1.0f, 1.0f)
            GlStateManager.popMatrix()
        }
    }

    /**
     * B23: the background quad is untextured, exactly like vanilla. Drawing it with
     * texture2D enabled sampled whatever texture happened to be bound.
     */
    private fun drawBackground(left: Int, width: Int, alpha: Float) {
        val right = left + width
        GlStateManager.disableTexture2D()
        val tessellator = Tessellator.getInstance()
        val worldRenderer = tessellator.worldRenderer
        worldRenderer.begin(GL11.GL_QUADS, DefaultVertexFormats.POSITION_COLOR)
        worldRenderer.pos((left - 1).toDouble(), -1.0, 0.0).color(0.0f, 0.0f, 0.0f, alpha).endVertex()
        worldRenderer.pos((left - 1).toDouble(), 8.0, 0.0).color(0.0f, 0.0f, 0.0f, alpha).endVertex()
        worldRenderer.pos((right + 1).toDouble(), 8.0, 0.0).color(0.0f, 0.0f, 0.0f, alpha).endVertex()
        worldRenderer.pos((right + 1).toDouble(), -1.0, 0.0).color(0.0f, 0.0f, 0.0f, alpha).endVertex()
        tessellator.draw()
        GlStateManager.enableTexture2D()
    }

    /**
     * Vanilla draws a label twice: a faint pass that shows through geometry and then
     * the opaque pass. `textShadow` used to switch the faint pass on and off (and was
     * therefore misnamed); it now means a real drop shadow, and both passes always run
     * so depth state is unconditionally restored afterwards (B22).
     *
     * Inline `§` colour codes in [text] (for example the prestige-coloured BedWars star
     * tag) are honoured by [FontRenderer.drawString]. The caller measures the same
     * string with `getStringWidth`, which counts them as zero width, so the centring
     * here and the background quad stay aligned with what is actually drawn.
     */
    private fun drawComponent(
        fontRenderer: FontRenderer,
        text: String,
        color: Color,
        x: Int,
        textShadow: Boolean
    ) {
        if (text.isEmpty()) return
        fontRenderer.drawString(text, x.toFloat(), 0.0f, SEE_THROUGH_TEXT_COLOR, false)
        fontRenderer.drawString(text, x.toFloat(), 0.0f, color.rgb, textShadow)
    }
}
