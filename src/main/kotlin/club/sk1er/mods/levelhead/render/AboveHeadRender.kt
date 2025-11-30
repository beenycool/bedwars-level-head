package club.sk1er.mods.levelhead.render

import club.sk1er.mods.levelhead.Levelhead
import club.sk1er.mods.levelhead.Levelhead.displayManager
import club.sk1er.mods.levelhead.core.BedwarsModeDetector
import net.minecraft.util.EnumChatFormatting
import net.minecraftforge.event.entity.player.PlayerEvent
import net.minecraftforge.fml.common.eventhandler.SubscribeEvent
import java.awt.Color
import kotlin.math.pow
import kotlin.math.sqrt

object AboveHeadRender {

    @SubscribeEvent
    fun onNameFormat(event: PlayerEvent.NameFormat) {
        // Basic checks to ensure we should be modifying the name
        if (!displayManager.config.enabled) return
        if (!Levelhead.isOnHypixel()) return

        // This check ensures tags only show when Bedwars mode is active (lobby or game)
        // Remove this line if you want stats to show everywhere on Hypixel
        if (!BedwarsModeDetector.shouldRenderTags()) return

        val player = event.entityPlayer

        // Get the primary display configuration
        val display = displayManager.aboveHead.firstOrNull() ?: return
        if (!display.config.enabled) return

        // Retrieve the cached stats tag for this player
        val tag = display.cache[player.uniqueID] ?: return

        // Calculate nearest Minecraft color codes from the Config's RGB values
        // because NameFormat requires strings, not raw RGB drawing
        val headerColorCode = getNearestColorCode(display.config.headerColor)
        val footerColorCode = getNearestColorCode(tag.footer.color)

        // Construct the string: "HeaderValue FooterValue"
        // Example output: "§bLevel: §654✫"
        val headerText = "$headerColorCode${tag.header.value}"
        val footerText = "$footerColorCode${tag.footer.value}"

        val fullTag = "$headerText$footerText"

        // Append the stats to the existing username.
        // You can change the order to "$fullTag ${event.displayname}" if you want it before the name.
        event.displayname = "${event.displayname} $fullTag"
    }

    /**
     * Helper to convert the mod's Java AWT Color to the nearest Minecraft EnumChatFormatting code.
     * This ensures the text isn't just plain white when injected into the nametag.
     */
    private fun getNearestColorCode(color: Color): EnumChatFormatting {
        var nearest = EnumChatFormatting.WHITE
        var minDistance = Double.MAX_VALUE

        for (code in EnumChatFormatting.values()) {
            if (!code.isColor) continue

            // Map Minecraft color codes to approximations
            val codeColor = getChatColorValue(code) ?: continue

            val dist = sqrt(
                (color.red - codeColor.red).toDouble().pow(2.0) +
                    (color.green - codeColor.green).toDouble().pow(2.0) +
                    (color.blue - codeColor.blue).toDouble().pow(2.0)
            )

            if (dist < minDistance) {
                minDistance = dist
                nearest = code
            }
        }
        return nearest
    }

    private fun getChatColorValue(chatColor: EnumChatFormatting): Color? {
        // Hardcoded mapping of 1.8.9 color codes to RGB
        return when (chatColor) {
            EnumChatFormatting.BLACK -> Color(0, 0, 0)
            EnumChatFormatting.DARK_BLUE -> Color(0, 0, 170)
            EnumChatFormatting.DARK_GREEN -> Color(0, 170, 0)
            EnumChatFormatting.DARK_AQUA -> Color(0, 170, 170)
            EnumChatFormatting.DARK_RED -> Color(170, 0, 0)
            EnumChatFormatting.DARK_PURPLE -> Color(170, 0, 170)
            EnumChatFormatting.GOLD -> Color(255, 170, 0)
            EnumChatFormatting.GRAY -> Color(170, 170, 170)
            EnumChatFormatting.DARK_GRAY -> Color(85, 85, 85)
            EnumChatFormatting.BLUE -> Color(85, 85, 255)
            EnumChatFormatting.GREEN -> Color(85, 255, 85)
            EnumChatFormatting.AQUA -> Color(85, 255, 255)
            EnumChatFormatting.RED -> Color(255, 85, 85)
            EnumChatFormatting.LIGHT_PURPLE -> Color(255, 85, 255)
            EnumChatFormatting.YELLOW -> Color(255, 255, 85)
            EnumChatFormatting.WHITE -> Color(255, 255, 255)
            else -> null
        }
    }
}
