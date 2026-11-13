package club.sk1er.mods.levelhead.core

import club.sk1er.mods.levelhead.config.DisplayConfig
import club.sk1er.mods.levelhead.config.LevelheadConfig
import club.sk1er.mods.levelhead.display.LevelheadTag
import club.sk1er.mods.levelhead.duels.DuelsStats
import club.sk1er.mods.levelhead.skywars.SkyWarsStats
import java.awt.Color
import java.util.Locale
import java.util.UUID

/**
 * Formats game statistics into displayable tags.
 * Handles template substitution and color styling for all game modes.
 */
object StatsFormatter {
    private val unresolvedTokenPattern = Regex("%[a-z0-9_]+%", RegexOption.IGNORE_CASE)

    
    /**
     * Build a LevelheadTag from GameStats and DisplayConfig.
     *
     * @param preferDisplayFooter when true, a non-blank [DisplayConfig.footerString]
     *   takes precedence over the global per-mode footer template (tab list).
     */
    fun formatTag(
        uuid: UUID,
        stats: GameStats?,
        config: DisplayConfig,
        gameMode: GameMode,
        preferDisplayFooter: Boolean = false
    ): LevelheadTag {
        val footerTemplate = LevelheadConfig.footerTemplateFor(gameMode, config, preferDisplayFooter)
        
        val (footerValue, footerColor) = if (stats?.nicked == true) {
            Pair("NICKED", Color.GRAY)
        } else {
            when (stats) {
                is GameStats.Bedwars -> formatBedwarsStats(stats, footerTemplate, config)
                is GameStats.Duels -> formatDuelsStats(stats, footerTemplate, config)
                is GameStats.SkyWars -> formatSkyWarsStats(stats, footerTemplate, config)
                // "Not fetched" is absence, not the text "?". Callers normally skip
                // null entirely; this keeps a defensive caller from rendering a
                // failure as if it were an answer.
                null -> Pair("", config.footerColor)
            }
        }
        
        // Staleness is derived from the fetch timestamp so a tag can be re-coloured
        // (or expired) later without recomputing the rest of the tag.
        val fetchedAt = stats?.fetchedAt ?: System.currentTimeMillis()
        val age = System.currentTimeMillis() - fetchedAt
        val isStale = age > 3600 * 1000
        
        val finalColor = if (isStale && stats != null) Color.GRAY else footerColor
        
        val tag = LevelheadTag(uuid)
        tag.fetchedAt = fetchedAt
        tag.header.value = "${config.headerString}: "
        tag.header.color = config.headerColor
        tag.footer.value = footerValue
        tag.footer.color = finalColor
        return tag
    }
    
    /**
     * Format BedWars stats.
     */
    private fun formatBedwarsStats(
        stats: GameStats.Bedwars,
        template: String,
        config: DisplayConfig
    ): Pair<String, Color> {
        val starValue = stats.star
        // Use the same prestige-aware tag as the tab fallback so the nametag, tab
        // and formatter never disagree on the icon or colours (B26/B29).
        val starString = starValue?.let { BedwarsStar.formatStarTag(it) } ?: "?"
        val fkdrString = stats.fkdr?.let { String.format(Locale.ROOT, "%.2f", it) } ?: "?"
        
        var footerValue = template
        footerValue = footerValue.replace("%star%", starString, ignoreCase = true)
        footerValue = footerValue.replace("%fkdr%", fkdrString, ignoreCase = true)
        footerValue = sanitizeUnresolvedTokens(footerValue)
        
        val style = starValue?.let { BedwarsStar.styleForStar(it) }
            ?: BedwarsStar.PrestigeStyle(config.footerColor, "")
        
        return Pair(footerValue, style.color)
    }
    
    /**
     * Format Duels stats.
     */
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
        
        var footerValue = template
        footerValue = footerValue.replace("%wins%", winsString, ignoreCase = true)
        footerValue = footerValue.replace("%losses%", lossesString, ignoreCase = true)
        footerValue = footerValue.replace("%wlr%", wlrString, ignoreCase = true)
        footerValue = footerValue.replace("%kdr%", kdrString, ignoreCase = true)
        footerValue = footerValue.replace("%division%", styledDivisionTitle, ignoreCase = true)
        footerValue = footerValue.replace("%divlevel%", divisionLevel, ignoreCase = true)
        footerValue = footerValue.replace("%divsymbol%", divisionSymbol, ignoreCase = true)
        footerValue = sanitizeUnresolvedTokens(footerValue)
        
        val duelsMode = LevelheadConfig.DuelsStatMode.entries.getOrNull(LevelheadConfig.duelsStatDisplayIndex)
            ?: LevelheadConfig.DuelsStatMode.DIVISION_TITLE
        val usesDivisionColor = when (duelsMode) {
            LevelheadConfig.DuelsStatMode.DIVISION_TITLE,
            LevelheadConfig.DuelsStatMode.DIVISION_SYMBOL -> true
            LevelheadConfig.DuelsStatMode.CUSTOM -> template.contains("%division%", ignoreCase = true)
            else -> false
        }
        val color = if (usesDivisionColor) (divisionInfo?.color ?: config.footerColor) else config.footerColor
        return Pair(footerValue, color)
    }
    
    /**
     * Format SkyWars stats.
     * Uses levelInt for display (integer only) while preserving Double precision internally.
     */
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

    private fun sanitizeUnresolvedTokens(value: String): String {
        return unresolvedTokenPattern.replace(value, "?")
    }
}
