package club.sk1er.mods.levelhead.core

import club.sk1er.mods.levelhead.bedwars.BedwarsFetcher
import com.google.gson.JsonObject
import gg.essential.universal.ChatColor
import java.awt.Color

object BedwarsStar {
    private val FIRST_LEVEL_EXPERIENCE = longArrayOf(500L, 1000L, 2000L, 3500L)
    private const val EXPERIENCE_PER_LEVEL = 5000L
    private const val EXPERIENCE_PER_PRESTIGE = 487_000L

    private val prestigeStyles = listOf(
        PrestigeStyle(Color.decode("#AAAAAA"), false), // Stone
        PrestigeStyle(Color.decode("#FFFFFF"), false), // Iron
        PrestigeStyle(Color.decode("#FFAA00"), false), // Gold
        PrestigeStyle(Color.decode("#55FFFF"), false), // Diamond
        PrestigeStyle(Color.decode("#55FF55"), false), // Emerald
        PrestigeStyle(Color.decode("#0000AA"), false), // Sapphire
        PrestigeStyle(Color.decode("#FF5555"), false), // Ruby
        PrestigeStyle(Color.decode("#FF55FF"), false), // Crystal
        PrestigeStyle(Color.decode("#00AAAA"), false), // Opal
        PrestigeStyle(Color.decode("#AA00AA"), false), // Amethyst
        PrestigeStyle(Color.WHITE, true), // Rainbow
        PrestigeStyle(Color.decode("#FFFFFF"), false), // Iron Prime
        PrestigeStyle(Color.decode("#FFAA00"), false), // Gold Prime
        PrestigeStyle(Color.decode("#55FFFF"), false), // Diamond Prime
        PrestigeStyle(Color.decode("#55FF55"), false), // Emerald Prime
        PrestigeStyle(Color.decode("#0000AA"), false), // Sapphire Prime
        PrestigeStyle(Color.decode("#FF5555"), false), // Ruby Prime
        PrestigeStyle(Color.decode("#FF55FF"), false), // Crystal Prime
        PrestigeStyle(Color.decode("#00AAAA"), false), // Opal Prime
        PrestigeStyle(Color.decode("#AA00AA"), false), // Amethyst Prime
        PrestigeStyle(Color.decode("#AAAAAA"), false), // Mirror
        PrestigeStyle(Color.decode("#FFAA00"), false), // Light
        PrestigeStyle(Color.decode("#FFFF55"), false), // Dawn
        PrestigeStyle(Color.decode("#AA00AA"), false), // Dusk
        PrestigeStyle(Color.decode("#FFFFFF"), false), // Air
        PrestigeStyle(Color.decode("#55FF55"), false), // Wind
        PrestigeStyle(Color.decode("#FF55FF"), false), // Nebula
        PrestigeStyle(Color.decode("#FFFF55"), false), // Thunder
        PrestigeStyle(Color.decode("#FFAA00"), false), // Earth
        PrestigeStyle(Color.decode("#55FFFF"), false), // Water
        PrestigeStyle(Color.decode("#FF5555"), false), // Fire
        PrestigeStyle(Color.decode("#FFFF55"), false), // Sunshine
        PrestigeStyle(Color.decode("#FF5555"), false), // Eclipse
        PrestigeStyle(Color.decode("#AA0000"), false), // Gamma
        PrestigeStyle(Color.decode("#FF55FF"), false), // Majestic
        PrestigeStyle(Color.decode("#55FF55"), false), // Andesine
        PrestigeStyle(Color.decode("#00AAAA"), false), // Marine
        PrestigeStyle(Color.decode("#55FFFF"), false), // Element
        PrestigeStyle(Color.decode("#AA00AA"), false), // Galaxy
        PrestigeStyle(Color.decode("#55FF55"), false), // Atomic
        PrestigeStyle(Color.decode("#FFAA00"), false), // Sunset
        PrestigeStyle(Color.decode("#FFFFFF"), false), // Time
        PrestigeStyle(Color.decode("#AAAAAA"), false), // Winter
        PrestigeStyle(Color.decode("#00AAAA"), false), // Obsidian
        PrestigeStyle(Color.decode("#FF55FF"), false), // Spring
        PrestigeStyle(Color.decode("#55FFFF"), false), // Ice
        PrestigeStyle(Color.decode("#FFFFFF"), false), // Summer
        PrestigeStyle(Color.decode("#AA00AA"), false), // Spinel
        PrestigeStyle(Color.decode("#55FF55"), false), // Autumn
        PrestigeStyle(Color.decode("#00AA00"), false), // Mystic
        PrestigeStyle(Color.decode("#AA0000"), false) // Eternal
    )

    data class PrestigeStyle(val color: Color, val chroma: Boolean)

    fun extractExperience(player: JsonObject?): Long? {
        player ?: return null

        return BedwarsFetcher.parseBedwarsExperience(player)
    }

    fun calculateStar(experience: Long): Int {
        if (experience <= 0L) return 0
        var remaining = experience
        var level = 0

        val prestiges = (remaining / EXPERIENCE_PER_PRESTIGE).toInt()
        level += prestiges * 100
        remaining -= prestiges * EXPERIENCE_PER_PRESTIGE

        for (cost in FIRST_LEVEL_EXPERIENCE) {
            if (remaining < cost) {
                return level
            }
            level += 1
            remaining -= cost
        }

        if (remaining > 0) {
            level += (remaining / EXPERIENCE_PER_LEVEL).toInt()
        }

        return level
    }

    fun styleForStar(star: Int): PrestigeStyle {
        val prestigeIndex = (star / 100).coerceAtLeast(0)
        val fallback = PrestigeStyle(ChatColor.GRAY.color ?: Color.GRAY, false)
        val prestigeStyle = prestigeStyles.getOrNull(prestigeIndex) ?: prestigeStyles.lastOrNull() ?: fallback
        return prestigeStyle.copy()
    }
}
