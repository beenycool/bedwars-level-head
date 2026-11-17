package club.sk1er.mods.levelhead.core

import java.awt.Color

object BedwarsStar {
    // XP values sourced from Hypixel's documented BedWars prestige math:
    // https://hypixel.net/threads/guide-bed-wars-xp-prestiges-items-cosmetics-all-things-in-one-thread.2558003/
    private val FIRST_LEVEL_EXPERIENCE = longArrayOf(500L, 1000L, 2000L, 3500L)
    private const val EXPERIENCE_PER_LEVEL = 5000L
    private const val EXPERIENCE_PER_PRESTIGE = 487_000L

    private val prestigeStyles = listOf(
        PrestigeStyle(Color.decode("#808080"), "7"),
        PrestigeStyle(Color.decode("#D1D5D8"), "f"),
        PrestigeStyle(Color.decode("#FAC51C"), "6"),
        PrestigeStyle(Color.decode("#00FFFF"), "b"),
        PrestigeStyle(Color.decode("#348017"), "2"),
        PrestigeStyle(Color.decode("#008080"), "3"),
        PrestigeStyle(Color.decode("#E41B17"), "4"),
        PrestigeStyle(Color.decode("#F535AA"), "d"),
        PrestigeStyle(Color.decode("#000FFF"), "9"),
        PrestigeStyle(Color.decode("#800080"), "5"),
        PrestigeStyle(Color.decode("#F75D59"), "c6eabd5"),
        PrestigeStyle(Color.decode("#D1D5D8"), "7ffff77"),
        PrestigeStyle(Color.decode("#F7DA64"), "7eeee67"),
        PrestigeStyle(Color.decode("#00FFFF"), "7bbbb37"),
        PrestigeStyle(Color.decode("#6AFB92"), "7aaaa27"),
        PrestigeStyle(Color.decode("#3B9C9C"), "7333397"),
        PrestigeStyle(Color.decode("#F75D59"), "7cccc47"),
        PrestigeStyle(Color.decode("#F535AA"), "7dddd57"),
        PrestigeStyle(Color.decode("#0000FF"), "7999917"),
        PrestigeStyle(Color.decode("#800080"), "7555587"),
        PrestigeStyle(Color.decode("#7C706B"), "87ff778"),
        PrestigeStyle(Color.decode("#D1D5D8"), "ffee666"),
        PrestigeStyle(Color.decode("#008080"), "66ffb33"),
        PrestigeStyle(Color.decode("#800080"), "55dd6ee"),
        PrestigeStyle(Color.decode("#00FFFF"), "bbff778"),
        PrestigeStyle(Color.decode("#6AFB92"), "ffaa222"),
        PrestigeStyle(Color.decode("#C11B17"), "44ccdd5"),
        PrestigeStyle(Color.decode("#FAC51C"), "eeff777"),
        PrestigeStyle(Color.decode("#347C17"), "aa2266e"),
        PrestigeStyle(Color.decode("#3B9C9C"), "bb33991"),
        PrestigeStyle(Color.decode("#F7DA64"), "ee66cc4"),
        PrestigeStyle(Color.decode("#3F51B5"), "993366e"),
        PrestigeStyle(Color.decode("#E25041"), "c4774cc"),
        PrestigeStyle(Color.decode("#3F51B5"), "999dcc4"),
        PrestigeStyle(Color.decode("#1B7920"), "2add552"),
        PrestigeStyle(Color.decode("#E25041"), "cc442aa"),
        PrestigeStyle(Color.decode("#2BFFEA"), "aaab991"),
        PrestigeStyle(Color.decode("#850000"), "44ccb33"),
        PrestigeStyle(Color.decode("#1A237E"), "11955d1"),
        PrestigeStyle(Color.decode("#E25041"), "ccaa399"),
        PrestigeStyle(Color.decode("#6A1B9A"), "55cc66e"),
        PrestigeStyle(Color.decode("#FBA026"), "ee6cdd5"),
        PrestigeStyle(Color.decode("#3F51B5"), "193bf77"),
        PrestigeStyle(Color.decode("#6A1B9A"), "0588550"),
        PrestigeStyle(Color.decode("#1B7920"), "22ae65d"),
        PrestigeStyle(Color.decode("#EFEFEF"), "ffbb333"),
        PrestigeStyle(Color.decode("#0097A7"), "3bee6d5"),
        PrestigeStyle(Color.decode("#EFEFEF"), "f4cc919"),
        PrestigeStyle(Color.decode("#6A1B9A"), "55c6eb3"),
        PrestigeStyle(Color.decode("#1B7920"), "2affaa2"),
        PrestigeStyle(Color.decode("#850000"), "4459910")
    )

    private val prestigeIcons = listOf(
        PrestigeIcon(0, "✫"),
        PrestigeIcon(1000, "✪"),
        PrestigeIcon(2000, "⚝"),
        PrestigeIcon(3000, "✥"),
        PrestigeIcon(4000, "✭")
    )

    data class PrestigeStyle(val color: Color, val colormap: String)
    data class PrestigeIcon(val level: Int, val symbol: String)

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
        val fallback = PrestigeStyle(Color.GRAY, "7")
        val prestigeStyle = prestigeStyles.getOrNull(prestigeIndex) ?: prestigeStyles.lastOrNull() ?: fallback
        return prestigeStyle.copy()
    }

    fun getPrestigeIcon(star: Int): String {
        return prestigeIcons
            .lastOrNull { it.level <= star }
            ?.symbol ?: "✫"
    }

    fun iconForCosmetic(id: String?): String? = when (id) {
        "star_black_open" -> "✫"
        "star_white_circled" -> "✪"
        "star_white_outlined" -> "⚝"
        "star_four_clubs" -> "✥"
        "star_black_outlined" -> "✭"
        "star_four_pointed" -> "✦"
        "star_pinwheel" -> "✯"
        "star_hollow" -> "✰"
        else -> null
    }

    fun formatStarTag(star: Int, iconOverride: String? = null): String {
        val style = styleForStar(star)
        val icon = iconOverride ?: getPrestigeIcon(star)
        val tag = "[$star$icon]"
        return applyColormap(tag, style.colormap)
    }

    private fun applyColormap(tag: String, colormap: String): String {
        if (colormap.isEmpty()) return tag

        val result = StringBuilder()
        val chars = tag.toCharArray()

        if (colormap.length == 1) {
            val color = colormap[0]
            for (char in chars) {
                result.append("§").append(color).append(char)
            }
        } else {
            for (i in chars.indices) {
                val colorIndex = i % colormap.length
                val color = colormap[colorIndex]
                result.append("§").append(color).append(chars[i])
            }
        }

        return result.toString()
    }
}
