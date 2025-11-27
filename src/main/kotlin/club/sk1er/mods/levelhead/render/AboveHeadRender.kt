package club.sk1er.mods.levelhead.render

import club.sk1er.mods.levelhead.Levelhead
import club.sk1er.mods.levelhead.Levelhead.displayManager
import club.sk1er.mods.levelhead.config.LevelheadConfig
import club.sk1er.mods.levelhead.core.BedwarsModeDetector
import club.sk1er.mods.levelhead.display.LevelheadTag
import kotlinx.coroutines.launch
import net.minecraft.client.Minecraft
import net.minecraft.client.gui.FontRenderer
import net.minecraft.client.renderer.GlStateManager
import net.minecraft.client.renderer.Tessellator
import net.minecraft.client.renderer.texture.DynamicTexture
import net.minecraft.client.renderer.vertex.DefaultVertexFormats
import net.minecraft.entity.player.EntityPlayer
import net.minecraft.util.ResourceLocation
import net.minecraftforge.client.event.RenderWorldLastEvent
import net.minecraftforge.fml.common.eventhandler.SubscribeEvent
import org.lwjgl.opengl.GL11
import java.awt.Color
import java.io.File
import java.util.Collections
import java.util.concurrent.ConcurrentHashMap
import javax.imageio.ImageIO

object AboveHeadRender {

    private val iconCache = ConcurrentHashMap<String, ResourceLocation>()
    private val loadingIcons: MutableSet<String> = Collections.newSetFromMap(ConcurrentHashMap())

    @SubscribeEvent
    fun render(event: RenderWorldLastEvent) {
        if (!LevelheadConfig.enabled) return
        if (!Levelhead.isOnHypixel()) return
        val minecraft = Minecraft.getMinecraft()
        if (minecraft.gameSettings.hideGUI) return
        if (!BedwarsModeDetector.shouldRenderTags()) return

        val localPlayer = minecraft.thePlayer ?: return
        val partialTicks = event.partialTicks

        val players = minecraft.theWorld.playerEntities
        val viewerX = minecraft.renderManager.viewerPosX
        val viewerY = minecraft.renderManager.viewerPosY
        val viewerZ = minecraft.renderManager.viewerPosZ

        displayManager.aboveHead.forEachIndexed { index, display ->
            if (!display.config.enabled) return@forEachIndexed

            players.forEach { player ->
                if (player.isInvisible || player.isInvisibleToPlayer(localPlayer)) return@forEach
                if (player.isSpectator) return@forEach
                if (player.isSneaking) return@forEach

                if (player == localPlayer && !LevelheadConfig.showSelf) return@forEach
                if (player == localPlayer && !display.config.showSelf) return@forEach

                val tag = display.cache[player.uniqueID] ?: return@forEach
                if (!display.loadOrRender(player)) return@forEach

                // Interpolate position
                val x = player.lastTickPosX + (player.posX - player.lastTickPosX) * partialTicks - viewerX
                val y = player.lastTickPosY + (player.posY - player.lastTickPosY) * partialTicks - viewerY
                val z = player.lastTickPosZ + (player.posZ - player.lastTickPosZ) * partialTicks - viewerZ

                var offset = 0.3
                val hasScoreboardObjective = player.worldScoreboard?.getObjectiveInDisplaySlot(2) != null
                val isCloseToLocalPlayer = player.getDistanceSqToEntity(localPlayer) < 100
                if (hasScoreboardObjective && isCloseToLocalPlayer) {
                    offset *= 2
                }
                if (player == localPlayer) {
                    offset = 0.0
                }

                offset += LevelheadConfig.offsetValue

                renderName(tag, player, x, y + offset + index * 0.3, z, index == 0)
            }
        }
    }

    private fun renderName(tag: LevelheadTag, entity: EntityPlayer, x: Double, y: Double, z: Double, isPrimary: Boolean) {
        val mc = Minecraft.getMinecraft()
        val renderer = mc.fontRendererObj
        val scale = (0.016666668f * 1.6f * displayManager.config.fontSize).toFloat()

        GlStateManager.pushMatrix()
        GlStateManager.translate(x.toFloat(), (y + entity.height + 0.5).toFloat(), z.toFloat())
        GL11.glNormal3f(0.0f, 1.0f, 0.0f)
        val view = mc.renderManager
        val xMultiplier = if (mc.gameSettings.thirdPersonView == 2) -1 else 1

        GlStateManager.rotate(-view.playerViewY, 0.0f, 1.0f, 0.0f)
        GlStateManager.rotate(view.playerViewX * xMultiplier, 1.0f, 0.0f, 0.0f)
        GlStateManager.scale(-scale, -scale, scale)
        GlStateManager.disableLighting()
        GlStateManager.depthMask(false)
        GlStateManager.disableDepth()
        GlStateManager.enableBlend()
        GlStateManager.tryBlendFuncSeparate(GL11.GL_SRC_ALPHA, GL11.GL_ONE_MINUS_SRC_ALPHA, GL11.GL_ONE, GL11.GL_ZERO)

        val icon = if (LevelheadConfig.customIcon && isPrimary) getCustomIcon(LevelheadConfig.customIconPath) else null

        val iconWidth = if (icon != null) 10 else 0
        val spacer = if (icon != null) 2 else 0

        val headerWidth = renderer.getStringWidth(tag.header.value)
        val footerWidth = renderer.getStringWidth(tag.footer.value)

        val totalWidth = headerWidth + iconWidth + spacer + footerWidth
        val halfWidth = totalWidth / 2

        drawBackground(halfWidth)

        var currentX = -halfWidth

        // Render Header
        renderComponent(renderer, tag.header, currentX)
        currentX += headerWidth

        // Render Icon
        if (icon != null) {
            GlStateManager.color(1f, 1f, 1f, 1f)
            Minecraft.getMinecraft().textureManager.bindTexture(icon)
            val tessellator = Tessellator.getInstance()
            val buffer = tessellator.worldRenderer

            val yBot = -1.0
            val yTop = 9.0

            buffer.begin(GL11.GL_QUADS, DefaultVertexFormats.POSITION_TEX)
            buffer.pos(currentX.toDouble(), yBot, 0.0).tex(0.0, 1.0).endVertex()
            buffer.pos(currentX.toDouble() + iconWidth, yBot, 0.0).tex(1.0, 1.0).endVertex()
            buffer.pos(currentX.toDouble() + iconWidth, yTop, 0.0).tex(1.0, 0.0).endVertex()
            buffer.pos(currentX.toDouble(), yTop, 0.0).tex(0.0, 0.0).endVertex()
            tessellator.draw()

            currentX += iconWidth + spacer
        }

        // Render Footer
        renderComponent(renderer, tag.footer, currentX)

        GlStateManager.enableLighting()
        GlStateManager.disableBlend()
        GlStateManager.color(1f, 1f, 1f, 1f)
        GlStateManager.depthMask(true)
        GlStateManager.enableDepth()
        GlStateManager.popMatrix()
    }

    private fun drawBackground(halfWidth: Int) {
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

    private fun getCustomIcon(path: String): ResourceLocation? {
        if (path.isBlank()) return null
        if (iconCache.containsKey(path)) return iconCache[path]

        if (loadingIcons.contains(path)) return null

        loadingIcons.add(path)
        Levelhead.scope.launch {
            try {
                val file = File(path)
                if (file.exists()) {
                    val image = ImageIO.read(file)
                    Minecraft.getMinecraft().addScheduledTask {
                        try {
                            val texture = DynamicTexture(image)
                            val location = Minecraft.getMinecraft().renderManager.renderEngine.getDynamicTextureLocation("levelhead_icon_${path.hashCode()}", texture)
                            iconCache[path] = location
                        } catch (e: Exception) {
                            Levelhead.logger.error("Failed to register custom icon texture for path: $path", e)
                        } finally {
                            loadingIcons.remove(path)
                        }
                    }
                } else {
                    loadingIcons.remove(path)
                }
            } catch (e: Exception) {
                Levelhead.logger.error("Failed to load custom icon: $path", e)
                loadingIcons.remove(path)
            }
        }
        return null
    }
}
