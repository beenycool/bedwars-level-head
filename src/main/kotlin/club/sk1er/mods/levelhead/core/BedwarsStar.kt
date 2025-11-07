package club.sk1er.mods.levelhead.core

import club.sk1er.mods.levelhead.bedwars.BedwarsFetcher
import com.google.gson.JsonObject
import gg.essential.universal.ChatColor
import java.awt.Color

object BedwarsStar {
    // XP values sourced from Hypixel's documented BedWars prestige math:
    // https://hypixel.net/threads/guide-bed-wars-xp-prestiges-items-cosmetics-all-things-in-one-thread.2558003/
    private val FIRST_LEVEL_EXPERIENCE = longArrayOf(500L, 1000L, 2000L, 3500L)
    private const val EXPERIENCE_PER_LEVEL = 5000L
    private const val EXPERIENCE_PER_PRESTIGE = 487_000L

    private val prestigeStyles = listOf(
        PrestigeStyle(Color.decode("#808080"), false), // Stone
        PrestigeStyle(Color.decode("#D1D5D8"), false), // Iron
        PrestigeStyle(Color.decode("#FAC51C"), false), // Gold
        PrestigeStyle(Color.decode("#00FFFF"), false), // Diamond
        PrestigeStyle(Color.decode("#348017"), false), // Emerald
        PrestigeStyle(Color.decode("#008080"), false), // Sapphire
        PrestigeStyle(Color.decode("#E41B17"), false), // Ruby
        PrestigeStyle(Color.decode("#F535AA"), false), // Crystal
        PrestigeStyle(Color.decode("#000FFF"), false), // Opal
        PrestigeStyle(Color.decode("#800080"), false), // Amethyst
        PrestigeStyle(Color.decode("#F75D59"), true), // Rainbow (gradient)
        PrestigeStyle(Color.decode("#D1D5D8"), false), // Iron Prime
        PrestigeStyle(Color.decode("#F7DA64"), false), // Gold Prime
        PrestigeStyle(Color.decode("#00FFFF"), false), // Diamond Prime
        PrestigeStyle(Color.decode("#6AFB92"), false), // Emerald Prime
        PrestigeStyle(Color.decode("#3B9C9C"), false), // Sapphire Prime
        PrestigeStyle(Color.decode("#F75D59"), false), // Ruby Prime
        PrestigeStyle(Color.decode("#F535AA"), false), // Crystal Prime
        PrestigeStyle(Color.decode("#0000FF"), false), // Opal Prime
        PrestigeStyle(Color.decode("#800080"), false), // Amethyst Prime
        PrestigeStyle(Color.decode("#7C706B"), false), // Mirror
        PrestigeStyle(Color.decode("#D1D5D8"), false), // Light
        PrestigeStyle(Color.decode("#008080"), false), // Dawn
        PrestigeStyle(Color.decode("#800080"), false), // Dusk
        PrestigeStyle(Color.decode("#00FFFF"), false), // Air
        PrestigeStyle(Color.decode("#6AFB92"), false), // Wind
        PrestigeStyle(Color.decode("#C11B17"), false), // Nebula
        PrestigeStyle(Color.decode("#FAC51C"), false), // Thunder
        PrestigeStyle(Color.decode("#347C17"), false), // Earth
        PrestigeStyle(Color.decode("#3B9C9C"), false), // Water
        PrestigeStyle(Color.decode("#F7DA64"), false), // Fire
        PrestigeStyle(Color.decode("#3F51B5"), false), // Sunshine
        PrestigeStyle(Color.decode("#E25041"), false), // Eclipse
        PrestigeStyle(Color.decode("#3F51B5"), false), // Gamma
        PrestigeStyle(Color.decode("#1B7920"), false), // Majestic
        PrestigeStyle(Color.decode("#E25041"), false), // Andesine
        PrestigeStyle(Color.decode("#2BFFEA"), false), // Marine
        PrestigeStyle(Color.decode("#850000"), false), // Element
        PrestigeStyle(Color.decode("#1A237E"), false), // Galaxy
        PrestigeStyle(Color.decode("#E25041"), false), // Atomic
        PrestigeStyle(Color.decode("#6A1B9A"), false), // Sunset
        PrestigeStyle(Color.decode("#FBA026"), false), // Time
        PrestigeStyle(Color.decode("#3F51B5"), false), // Winter
        PrestigeStyle(Color.decode("#6A1B9A"), false), // Obsidian
        PrestigeStyle(Color.decode("#1B7920"), false), // Spring
        PrestigeStyle(Color.decode("#EFEFEF"), false), // Ice
        PrestigeStyle(Color.decode("#0097A7"), false), // Summer
        PrestigeStyle(Color.decode("#EFEFEF"), false), // Spinel
        PrestigeStyle(Color.decode("#6A1B9A"), false), // Autumn
        PrestigeStyle(Color.decode("#1B7920"), false), // Mystic
        PrestigeStyle(Color.decode("#850000"), false) // Eternal
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
