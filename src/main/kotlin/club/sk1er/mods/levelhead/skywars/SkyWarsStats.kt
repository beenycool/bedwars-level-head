package club.sk1er.mods.levelhead.skywars

import club.sk1er.mods.levelhead.core.ratioOf
import java.awt.Color

object SkyWarsStats {
    /**
     * Per-level XP increments (NOT cumulative). To reach level n, sum xpRequirements[0..n-1].
     * Matches the Hypixel/Slothpixel curve, which then continues at 10000 XP per level.
     */
    private val xpRequirements = longArrayOf(
        0,
        20,
        50,
        80,
        100,
        250,
        500,
        1000,
        1500,
        2500,
        4000,
        5000
    )

    private val cumulativeXP: LongArray by lazy {
        val result = LongArray(xpRequirements.size)
        var sum = 0L
        for (i in xpRequirements.indices) {
            sum += xpRequirements[i]
            result[i] = sum
        }
        result
    }

    private const val XP_PER_LEVEL_AFTER_TABLE = 10_000L
    private const val MAX_LEVEL = 10000

    data class PrestigeStyle(
        val minLevel: Int,
        val color: Color,
        val colormap: String = ""
    )

    private val prestigeStyles = listOf(
        PrestigeStyle(0, Color(170, 170, 170)),   // gray
        PrestigeStyle(5, Color(255, 255, 255)),   // iron
        PrestigeStyle(10, Color(255, 170, 0)),    // gold
        PrestigeStyle(15, Color(85, 255, 255)),   // diamond
        PrestigeStyle(20, Color(85, 255, 85)),    // emerald
        PrestigeStyle(25, Color(85, 85, 255)),    // sapphire
        PrestigeStyle(30, Color(255, 85, 85)),    // ruby
        PrestigeStyle(35, Color(255, 85, 255)),   // crystal
        PrestigeStyle(40, Color(0, 170, 170)),    // opal
        PrestigeStyle(45, Color(170, 0, 170)),    // amethyst
        PrestigeStyle(50, Color(255, 85, 255), "c6eabd"),   // rainbow
        PrestigeStyle(60, Color(170, 0, 0))       // mythic
    )

    data class EmblemMilestone(val minLevel: Int, val emblem: String)

    private val defaultEmblems = listOf(
        EmblemMilestone(0, "✯"),
        EmblemMilestone(50, "^_^"),
        EmblemMilestone(100, "@_@"),
        EmblemMilestone(150, "δvδ"),
        EmblemMilestone(200, "zz_zz"),
        EmblemMilestone(250, "■·■"),
        EmblemMilestone(300, "ಠ_ಠ"),
        EmblemMilestone(350, "o...0"),
        EmblemMilestone(400, ">u<"),
        EmblemMilestone(450, "v-v"),
        EmblemMilestone(500, "༼つ◕_◕༽つ")
    )

    fun calculateLevel(experience: Long): Double {
        if (experience <= 0) return 1.0

        val constantLevelingXP = cumulativeXP.last()

        if (experience >= constantLevelingXP) {
            val xpAboveConstant = experience - constantLevelingXP
            val level = (xpAboveConstant.toDouble() / XP_PER_LEVEL_AFTER_TABLE) + cumulativeXP.size
            return level.coerceAtMost(MAX_LEVEL.toDouble())
        }

        for (i in cumulativeXP.indices) {
            if (experience < cumulativeXP[i]) {
                val prevXP = if (i > 0) cumulativeXP[i - 1] else 0
                val progress = (experience - prevXP).toDouble() / (cumulativeXP[i] - prevXP).toDouble()
                return (i + progress).coerceAtLeast(1.0)
            }
        }

        return cumulativeXP.size.toDouble()
    }

    fun getPrestigeStyle(level: Int): PrestigeStyle {
        return prestigeStyles.lastOrNull { level >= it.minLevel } ?: prestigeStyles.first()
    }

    fun getDefaultEmblem(level: Int): String {
        return defaultEmblems.lastOrNull { level >= it.minLevel }?.emblem ?: "✯"
    }

    fun formatLevelTag(level: Int, style: PrestigeStyle = getPrestigeStyle(level)): String {
        return applyColormap("$level${getDefaultEmblem(level)}", style.colormap)
    }

    private fun applyColormap(text: String, colormap: String): String {
        if (colormap.isEmpty()) return text

        val result = StringBuilder()
        val chars = text.toCharArray()
        for (i in chars.indices) {
            val color = colormap[i % colormap.length]
            result.append('§').append(color).append(chars[i])
        }
        return result.toString()
    }

    fun calculateKDR(kills: Int?, deaths: Int?): Double? = ratioOf(kills, deaths)

    fun calculateWLR(wins: Int?, losses: Int?): Double? = ratioOf(wins, losses)
}
