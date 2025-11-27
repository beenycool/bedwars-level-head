package club.sk1er.mods.levelhead.render

import club.sk1er.mods.levelhead.Levelhead
import club.sk1er.mods.levelhead.config.LevelheadConfig
import net.minecraft.client.Minecraft
import net.minecraft.client.renderer.texture.DynamicTexture
import net.minecraft.util.ResourceLocation
import java.io.File
import javax.imageio.ImageIO

object TextureManager {
    private const val CUSTOM_ICON_ID = "levelhead_custom_icon"
    private var cachedPath: String = ""
    private var cachedResource: ResourceLocation? = null

    fun getCustomIcon(): ResourceLocation? {
        if (!LevelheadConfig.customIconEnabled) {
            return null
        }

        val path = LevelheadConfig.customIconPath.trim()
        if (path.isEmpty()) {
            return null
        }

        if (cachedResource != null && path == cachedPath) {
            return cachedResource
        }

        val file = File(path)
        if (!file.exists()) {
            cachedPath = path
            cachedResource = null
            return null
        }

        return try {
            val image = ImageIO.read(file) ?: return null
            val dynamicTexture = DynamicTexture(image)
            val location = Minecraft.getMinecraft().renderEngine.getDynamicTextureLocation(CUSTOM_ICON_ID, dynamicTexture)
            cachedPath = path
            cachedResource = location
            location
        } catch (throwable: Throwable) {
            Levelhead.logger.error("Failed to load custom icon from $path", throwable)
            cachedResource = null
            null
        }
    }

    fun invalidateCustomIcon() {
        cachedPath = ""
        cachedResource = null
    }
}
