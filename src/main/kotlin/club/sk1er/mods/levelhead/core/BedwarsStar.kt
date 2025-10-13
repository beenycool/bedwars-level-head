package club.sk1er.mods.levelhead.core

import com.google.gson.JsonObject
import gg.essential.universal.ChatColor
import java.awt.Color

object BedwarsStar {
    private val FIRST_LEVEL_EXPERIENCE = longArrayOf(500L, 1000L, 2000L, 3500L)
    private const val EXPERIENCE_PER_LEVEL = 5000L
    private const val EXPERIENCE_PER_PRESTIGE = 487_000L

    private val prestigeColors = listOf(
        ChatColor.GRAY,
        ChatColor.WHITE,
        ChatColor.GOLD,
        ChatColor.AQUA,
        ChatColor.GREEN,
        ChatColor.DARK_RED,
        ChatColor.LIGHT_PURPLE,
        ChatColor.DARK_GRAY,
        ChatColor.DARK_AQUA,
        ChatColor.BLACK
    )

    data class PrestigeStyle(val color: Color, val chroma: Boolean)

    fun extractExperience(player: JsonObject?): Long? {
        player ?: return null
        val stats = player.getAsJsonObject("stats") ?: return null
        val bedwars = stats.getAsJsonObject("Bedwars") ?: return null
        val experienceEntry = bedwars.entrySet()
            .firstOrNull { (key, _) -> key.equals("Experience", true) || key.equals("bedwars_experience", true) }
            ?: return null
        return kotlin.runCatching { experienceEntry.value.asLong }.getOrNull()
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
        if (star >= 1000) {
            return PrestigeStyle(ChatColor.WHITE.color!!, true)
        }
        val prestige = (star / 100).coerceAtLeast(0)
        val chatColor = prestigeColors.getOrNull(prestige)?.color ?: ChatColor.GRAY.color!!
        return PrestigeStyle(chatColor, false)
    }
}
