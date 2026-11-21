package club.sk1er.mods.levelhead.core

import club.sk1er.mods.levelhead.config.DisplayConfig
import club.sk1er.mods.levelhead.config.LevelheadConfig
import club.sk1er.mods.levelhead.display.LevelheadTag
import club.sk1er.mods.levelhead.duels.DuelsStats
import club.sk1er.mods.levelhead.skywars.SkyWarsStats
import java.awt.Color
import java.util.Locale
import java.util.UUID
import net.minecraft.util.EnumChatFormatting

object StatsFormatter {
    private val unresolvedTokenPattern = Regex("%[a-z0-9_]+%", RegexOption.IGNORE_CASE)

    fun isStale(stats: GameStats?, now: Long = System.currentTimeMillis()): Boolean =
        stats?.isExpired(LevelheadConfig.starCacheTtl, now) ?: false

    fun formatTag(
        uuid: UUID,
        stats: GameStats?,
        config: DisplayConfig,
        gameMode: GameMode,
        now: Long = System.currentTimeMillis()
    ): LevelheadTag {
        val footerTemplate = LevelheadConfig.footerTemplateFor(gameMode)

        val (footerValue, footerColor) = if (stats?.nicked == true) {
            Pair("NICKED", Color.GRAY)
        } else {
            when (stats) {
                is GameStats.Bedwars -> formatBedwarsStats(stats, footerTemplate, config)
                is GameStats.Duels -> formatDuelsStats(stats, footerTemplate, config)
                is GameStats.SkyWars -> formatSkyWarsStats(stats, footerTemplate, config)
                null -> Pair("", config.footerColor)
            }
        }

        val stale = isStale(stats, now)
        val finalColor = if (stale && stats != null) Color.GRAY else footerColor

        val tag = LevelheadTag(uuid)
        tag.header.value = config.headerStringFor(gameMode).takeIf { it.isNotBlank() }?.let { "$it: " } ?: ""
        tag.header.color = config.headerColor
        tag.footer.value = footerValue
        tag.footer.color = finalColor
        return tag
    }

    private fun formatBedwarsStats(
        stats: GameStats.Bedwars,
        template: String,
        config: DisplayConfig
    ): Pair<String, Color> {
        val starValue = stats.star
        val starString = starValue?.let { BedwarsStar.formatStarTag(it, stats.starIcon) } ?: "?"
        val fkdrString = stats.fkdr?.let { String.format(Locale.ROOT, "%.2f", it) } ?: "?"

        val style = starValue?.let { BedwarsStar.styleForStar(it) }
            ?: BedwarsStar.PrestigeStyle(config.footerColor, "")

        var footerValue = template
        footerValue = replaceStyled(footerValue, "%star%", starString, style.color)
        footerValue = footerValue.replace("%fkdr%", fkdrString, ignoreCase = true)
        footerValue = sanitizeUnresolvedTokens(footerValue)

        return Pair(footerValue, style.color)
    }

    private fun formatDuelsStats(
        stats: GameStats.Duels,
        template: String,
        config: DisplayConfig
    ): Pair<String, Color> {
        val winsString = stats.wins?.toString() ?: "?"
        val lossesString = stats.losses?.toString() ?: "?"
        val wlrString = DuelsStats.calculateWLR(stats.wins, stats.losses)
            ?.let { String.format(Locale.ROOT, "%.2f", it) } ?: "?"
        val kdrString = DuelsStats.calculateKDR(stats.kills, stats.deaths)
            ?.let { String.format(Locale.ROOT, "%.2f", it) } ?: "?"
        val divisionInfo = stats.wins?.let { DuelsStats.getOverallDivisionInfo(it) }
        val divisionTitle = divisionInfo?.displayName ?: "?"
        val styledDivisionTitle = when {
            divisionInfo == null -> divisionTitle
            divisionInfo.bold -> "§l$divisionTitle"
            else -> divisionTitle
        }
        val divisionLevel = divisionInfo?.romanLevel ?: "?"
        val divisionSymbol = divisionInfo?.let { DuelsStats.symbolForDivisionId(it.id) } ?: "?"

        val duelsMode = LevelheadConfig.DuelsStatMode.entries.getOrNull(LevelheadConfig.duelsStatDisplayIndex)
            ?: LevelheadConfig.DuelsStatMode.DIVISION_TITLE
        val usesDivisionColor = when (duelsMode) {
            LevelheadConfig.DuelsStatMode.DIVISION_TITLE,
            LevelheadConfig.DuelsStatMode.DIVISION_SYMBOL -> true
            LevelheadConfig.DuelsStatMode.CUSTOM ->
                template.contains("%division%", ignoreCase = true) ||
                    template.contains("%divsymbol%", ignoreCase = true)
            else -> false
        }
        val color = if (usesDivisionColor) (divisionInfo?.color ?: config.footerColor) else config.footerColor

        var footerValue = template
        footerValue = footerValue.replace("%wins%", winsString, ignoreCase = true)
        footerValue = footerValue.replace("%losses%", lossesString, ignoreCase = true)
        footerValue = footerValue.replace("%wlr%", wlrString, ignoreCase = true)
        footerValue = footerValue.replace("%kdr%", kdrString, ignoreCase = true)
        footerValue = replaceStyled(footerValue, "%division%", styledDivisionTitle, color)
        footerValue = footerValue.replace("%divlevel%", divisionLevel, ignoreCase = true)
        footerValue = footerValue.replace("%divsymbol%", divisionSymbol, ignoreCase = true)
        footerValue = sanitizeUnresolvedTokens(footerValue)

        return Pair(footerValue, color)
    }

    private fun formatSkyWarsStats(
        stats: GameStats.SkyWars,
        template: String,
        config: DisplayConfig
    ): Pair<String, Color> {
        val levelValue: Int? = stats.level?.toInt()
        val starString = levelValue?.let { "$it${SkyWarsStats.getDefaultEmblem(it)}" } ?: "?"
        val winsString = stats.wins?.toString() ?: "?"
        val lossesString = stats.losses?.toString() ?: "?"
        val wlrString = SkyWarsStats.calculateWLR(stats.wins, stats.losses)
            ?.let { String.format(Locale.ROOT, "%.2f", it) } ?: "?"
        val kdrString = SkyWarsStats.calculateKDR(stats.kills, stats.deaths)
            ?.let { String.format(Locale.ROOT, "%.2f", it) } ?: "?"

        var footerValue = template
        footerValue = footerValue.replace("%star%", starString, ignoreCase = true)
        footerValue = footerValue.replace("%level%", levelValue?.toString() ?: "?", ignoreCase = true)
        footerValue = footerValue.replace("%wins%", winsString, ignoreCase = true)
        footerValue = footerValue.replace("%losses%", lossesString, ignoreCase = true)
        footerValue = footerValue.replace("%wlr%", wlrString, ignoreCase = true)
        footerValue = footerValue.replace("%kdr%", kdrString, ignoreCase = true)
        footerValue = sanitizeUnresolvedTokens(footerValue)

        val style = levelValue?.let { SkyWarsStats.getPrestigeStyle(it) }
        val color = style?.color ?: config.footerColor

        return Pair(footerValue, color)
    }

    /**
     * Replaces a placeholder whose substitution carries its own § codes. If any
     * text follows it, a reset plus the footer colour is inserted so that text
     * does not inherit the substitution's last colour (or its bold flag).
     */
    private fun replaceStyled(
        template: String,
        token: String,
        replacement: String,
        footerColor: Color
    ): String {
        if (!template.contains(token, ignoreCase = true)) return template
        val suffix = "§r" + chatColorCode(footerColor)
        return Regex(Regex.escape(token), RegexOption.IGNORE_CASE).replace(template) { match ->
            if (template.substring(match.range.last + 1).isBlank()) replacement else replacement + suffix
        }
    }

    private val CHAT_COLORS: List<Pair<EnumChatFormatting, Color>> = listOf(
        EnumChatFormatting.BLACK to Color(0, 0, 0),
        EnumChatFormatting.DARK_BLUE to Color(0, 0, 170),
        EnumChatFormatting.DARK_GREEN to Color(0, 170, 0),
        EnumChatFormatting.DARK_AQUA to Color(0, 170, 170),
        EnumChatFormatting.DARK_RED to Color(170, 0, 0),
        EnumChatFormatting.DARK_PURPLE to Color(170, 0, 170),
        EnumChatFormatting.GOLD to Color(255, 170, 0),
        EnumChatFormatting.GRAY to Color(170, 170, 170),
        EnumChatFormatting.DARK_GRAY to Color(85, 85, 85),
        EnumChatFormatting.BLUE to Color(85, 85, 255),
        EnumChatFormatting.GREEN to Color(85, 255, 85),
        EnumChatFormatting.AQUA to Color(85, 255, 255),
        EnumChatFormatting.RED to Color(255, 85, 85),
        EnumChatFormatting.LIGHT_PURPLE to Color(255, 85, 255),
        EnumChatFormatting.YELLOW to Color(255, 255, 85),
        EnumChatFormatting.WHITE to Color(255, 255, 255)
    )

    private fun chatColorCode(color: Color): String {
        var best = EnumChatFormatting.WHITE
        var bestDist = Int.MAX_VALUE
        for ((fmt, c) in CHAT_COLORS) {
            val dr = color.red - c.red
            val dg = color.green - c.green
            val db = color.blue - c.blue
            val dist = dr * dr + dg * dg + db * db
            if (dist < bestDist) {
                bestDist = dist
                best = fmt
            }
        }
        return best.toString()
    }

    private fun sanitizeUnresolvedTokens(value: String): String {
        return unresolvedTokenPattern.replace(value, "?")
    }
}
