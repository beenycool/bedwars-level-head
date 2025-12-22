package club.sk1er.mods.levelhead.core

import club.sk1er.mods.levelhead.bedwars.BedwarsFetcher
import com.google.gson.JsonObject
import java.awt.Color

object BedwarsStar {
    // XP values sourced from Hypixel's documented BedWars prestige math:
    // https://hypixel.net/threads/guide-bed-wars-xp-prestiges-items-cosmetics-all-things-in-one-thread.2558003/
    private val FIRST_LEVEL_EXPERIENCE = longArrayOf(500L, 1000L, 2000L, 3500L)
    private const val EXPERIENCE_PER_LEVEL = 5000L
    private const val EXPERIENCE_PER_PRESTIGE = 487_000L

    // All 50 prestige tiers with accurate colormaps matching Hypixel's implementation
    private val prestigeStyles = listOf(
        PrestigeStyle(Color.decode("#808080"), false, "7"),      // 0-99: None (Gray)
        PrestigeStyle(Color.decode("#D1D5D8"), false, "f"),      // 100-199: Iron (White)
        PrestigeStyle(Color.decode("#FAC51C"), false, "6"),      // 200-299: Gold
        PrestigeStyle(Color.decode("#00FFFF"), false, "b"),      // 300-399: Diamond (Aqua)
        PrestigeStyle(Color.decode("#348017"), false, "2"),      // 400-499: Emerald (Dark Green)
        PrestigeStyle(Color.decode("#008080"), false, "3"),      // 500-599: Sapphire (Dark Aqua)
        PrestigeStyle(Color.decode("#E41B17"), false, "4"),      // 600-699: Ruby (Dark Red)
        PrestigeStyle(Color.decode("#F535AA"), false, "d"),      // 700-799: Crystal (Light Purple)
        PrestigeStyle(Color.decode("#000FFF"), false, "9"),      // 800-899: Opal (Blue)
        PrestigeStyle(Color.decode("#800080"), false, "5"),      // 900-999: Amethyst (Dark Purple)
        PrestigeStyle(Color.decode("#F75D59"), false, "c6eabd5"), // 1000-1099: Rainbow
        PrestigeStyle(Color.decode("#D1D5D8"), false, "7ffff77"), // 1100-1199: Iron Prime
        PrestigeStyle(Color.decode("#F7DA64"), false, "7eeee67"), // 1200-1299: Gold Prime
        PrestigeStyle(Color.decode("#00FFFF"), false, "7bbbb37"), // 1300-1399: Diamond Prime
        PrestigeStyle(Color.decode("#6AFB92"), false, "7aaaa27"), // 1400-1499: Emerald Prime
        PrestigeStyle(Color.decode("#3B9C9C"), false, "7333397"), // 1500-1599: Sapphire Prime
        PrestigeStyle(Color.decode("#F75D59"), false, "7cccc47"), // 1600-1699: Ruby Prime
        PrestigeStyle(Color.decode("#F535AA"), false, "7dddd57"), // 1700-1799: Crystal Prime
        PrestigeStyle(Color.decode("#0000FF"), false, "7999917"), // 1800-1899: Opal Prime
        PrestigeStyle(Color.decode("#800080"), false, "7555587"), // 1900-1999: Amethyst Prime
        PrestigeStyle(Color.decode("#7C706B"), false, "87ff778"), // 2000-2099: Mirror
        PrestigeStyle(Color.decode("#D1D5D8"), false, "ffee666"), // 2100-2199: Light
        PrestigeStyle(Color.decode("#008080"), false, "66ffb33"), // 2200-2299: Dawn
        PrestigeStyle(Color.decode("#800080"), false, "55dd6ee"), // 2300-2399: Dusk
        PrestigeStyle(Color.decode("#00FFFF"), false, "bbff778"), // 2400-2499: Air
        PrestigeStyle(Color.decode("#6AFB92"), false, "ffaa222"), // 2500-2599: Wind
        PrestigeStyle(Color.decode("#C11B17"), false, "44ccdd5"), // 2600-2699: Nebula
        PrestigeStyle(Color.decode("#FAC51C"), false, "eeff777"), // 2700-2799: Thunder
        PrestigeStyle(Color.decode("#347C17"), false, "aa2266e"), // 2800-2899: Earth
        PrestigeStyle(Color.decode("#3B9C9C"), false, "bb33991"), // 2900-2999: Water
        PrestigeStyle(Color.decode("#F7DA64"), false, "ee66cc4"), // 3000-3099: Fire
        PrestigeStyle(Color.decode("#3F51B5"), false, "993366e"), // 3100-3199: Sunshine
        PrestigeStyle(Color.decode("#E25041"), false, "c4774cc"), // 3200-3299: Eclipse
        PrestigeStyle(Color.decode("#3F51B5"), false, "999dcc4"), // 3300-3399: Gamma
        PrestigeStyle(Color.decode("#1B7920"), false, "2add552"), // 3400-3499: Majestic
        PrestigeStyle(Color.decode("#E25041"), false, "cc442aa"), // 3500-3599: Andesine
        PrestigeStyle(Color.decode("#2BFFEA"), false, "aaab991"), // 3600-3699: Marine
        PrestigeStyle(Color.decode("#850000"), false, "44ccb33"), // 3700-3799: Element
        PrestigeStyle(Color.decode("#1A237E"), false, "11955d1"), // 3800-3899: Galaxy
        PrestigeStyle(Color.decode("#E25041"), false, "ccaa399"), // 3900-3999: Atomic
        PrestigeStyle(Color.decode("#6A1B9A"), false, "55cc66e"), // 4000-4099: Sunset
        PrestigeStyle(Color.decode("#FBA026"), false, "ee6cdd5"), // 4100-4199: Time
        PrestigeStyle(Color.decode("#3F51B5"), false, "193bf77"), // 4200-4299: Winter
        PrestigeStyle(Color.decode("#6A1B9A"), false, "0588550"), // 4300-4399: Obsidian
        PrestigeStyle(Color.decode("#1B7920"), false, "22ae65d"), // 4400-4499: Spring
        PrestigeStyle(Color.decode("#EFEFEF"), false, "ffbb333"), // 4500-4599: Ice
        PrestigeStyle(Color.decode("#0097A7"), false, "3bee6d5"), // 4600-4699: Summer
        PrestigeStyle(Color.decode("#EFEFEF"), false, "f4cc919"), // 4700-4799: Spinel
        PrestigeStyle(Color.decode("#6A1B9A"), false, "55c6eb3"), // 4800-4899: Autumn
        PrestigeStyle(Color.decode("#1B7920"), false, "2affaa2"), // 4900-4999: Mystic
        PrestigeStyle(Color.decode("#850000"), false, "4459910")  // 5000+: Eternal
    )

    // Star symbols change at specific prestige levels
    private val prestigeIcons = listOf(
        PrestigeIcon(0, "✫"),
        PrestigeIcon(1100, "✪"),
        PrestigeIcon(2100, "⚝"),
        PrestigeIcon(3100, "✥")
    )

    data class PrestigeStyle(val color: Color, val chroma: Boolean, val colormap: String)
    data class PrestigeIcon(val level: Int, val symbol: String)

    enum class ThreatLevel(val color: Color) {
        LOW(Color(170, 170, 170)),
        NORMAL(Color(85, 255, 85)),
        HIGH(Color(255, 85, 85)),
        EXTREME(Color(139, 0, 0));

        companion object {
            fun determine(fkdr: Double?): ThreatLevel {
                val ratio = fkdr ?: 0.0
                return when {
                    ratio > 10.0 -> EXTREME
                    ratio > 3.0 -> HIGH
                    ratio > 1.0 -> NORMAL
                    else -> LOW
                }
            }
        }
    }

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
        val fallback = PrestigeStyle(Color.GRAY, false, "7")
        val prestigeStyle = prestigeStyles.getOrNull(prestigeIndex) ?: prestigeStyles.lastOrNull() ?: fallback
        return prestigeStyle.copy()
    }

    /**
     * Get the appropriate star symbol for the given level.
     * Star symbols change at specific prestige tiers:
     * 0-1099: ✫
     * 1100-2099: ✪
     * 2100-3099: ⚝
     * 3100+: ✥
     */
    fun getPrestigeIcon(star: Int): String {
        return prestigeIcons
            .lastOrNull { it.level <= star }
            ?.symbol ?: "✫"
    }

    /**
     * Format a star tag with accurate per-character coloring.
     * For single-color prestiges (colormap length 1): all characters get the same color
     * For multi-color prestiges: each character position maps to its corresponding color code
     *
     * Example for level 1234 with Rainbow colormap "c6eabd5":
     * Input: "[1234✫]"
     * Output: "§c[§61§e2§a3§b4§d✫§5]"
     */
    fun formatStarTag(star: Int): String {
        val style = styleForStar(star)
        val icon = getPrestigeIcon(star)
        val tag = "[$star$icon]"
        return applyColormap(tag, style.colormap)
    }

    /**
     * Apply colormap to each character in the tag.
     * - For single-char colormaps (e.g. "7"): all characters get that color
     * - For multi-char colormaps (e.g. "c6eabd5"): each position gets its corresponding color
     */
    private fun applyColormap(tag: String, colormap: String): String {
        if (colormap.isEmpty()) return tag

        val result = StringBuilder()
        val chars = tag.toCharArray()

        if (colormap.length == 1) {
            // Single color for all characters
            val color = colormap[0]
            for (char in chars) {
                result.append("§").append(color).append(char)
            }
        } else {
            // Multi-color: map each character position to colormap
            for (i in chars.indices) {
                val colorIndex = i % colormap.length
                val color = colormap[colorIndex]
                result.append("§").append(color).append(chars[i])
            }
        }

        return result.toString()
    }
}
