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
    
    /**
     * Build a LevelheadTag from GameStats and DisplayConfig.
     */
    fun formatTag(
        uuid: UUID,
        stats: GameStats?,
        config: DisplayConfig,
        gameMode: GameMode
    ): LevelheadTag {
        val footerTemplate = LevelheadConfig.footerTemplateFor(gameMode, config)
        
        val (footerValue, footerColor, chroma) = if (stats?.nicked == true) {
            Triple("NICKED", Color.GRAY, false)
        } else {
            when (stats) {
                is GameStats.Bedwars -> formatBedwarsStats(stats, footerTemplate, config)
                is GameStats.Duels -> formatDuelsStats(stats, footerTemplate, config)
                is GameStats.SkyWars -> formatSkyWarsStats(stats, footerTemplate, config)
                null -> Triple("?", config.footerColor, false)
            }
        }
        
        // Check if data is stale (> 1 hour old)
        val age = System.currentTimeMillis() - (stats?.fetchedAt ?: 0L)
        val isStale = age > 3600 * 1000
        
        val finalColor = if (isStale && stats != null) Color.GRAY else footerColor
        val finalChroma = if (isStale) false else chroma
        
        return LevelheadTag.build(uuid) {
            header {
                value = "${config.headerString}: "
                color = config.headerColor
                this.chroma = false
            }
            footer {
                value = footerValue
                color = finalColor
                this.chroma = finalChroma
            }
        }
    }
    
    /**
     * Format BedWars stats.
     */
    private fun formatBedwarsStats(
        stats: GameStats.Bedwars,
        template: String,
        config: DisplayConfig
    ): Triple<String, Color, Boolean> {
        val starValue = stats.star
        val starString = starValue?.let { "$it✪" } ?: "?"
        val fkdrString = stats.fkdr?.let { String.format(Locale.ROOT, "%.2f", it) } ?: "?"
        val winstreakString = stats.winstreak?.toString() ?: "?"
        
        var footerValue = template
        footerValue = footerValue.replace("%star%", starString, ignoreCase = true)
        footerValue = footerValue.replace("%fkdr%", fkdrString, ignoreCase = true)
        footerValue = footerValue.replace("%ws%", winstreakString, ignoreCase = true)
        
        val style = starValue?.let { BedwarsStar.styleForStar(it) }
            ?: BedwarsStar.PrestigeStyle(config.footerColor, false, "")
        
        return Triple(footerValue, style.color, style.chroma)
    }
    
    /**
     * Format Duels stats.
     */
    private fun formatDuelsStats(
        stats: GameStats.Duels,
        template: String,
        config: DisplayConfig
    ): Triple<String, Color, Boolean> {
        val winsString = stats.wins?.toString() ?: "?"
        val lossesString = stats.losses?.toString() ?: "?"
        val wlrString = DuelsStats.calculateWLR(stats.wins, stats.losses)
            ?.let { String.format(Locale.ROOT, "%.2f", it) } ?: "?"
        val kdrString = DuelsStats.calculateKDR(stats.kills, stats.deaths)
            ?.let { String.format(Locale.ROOT, "%.2f", it) } ?: "?"
        val winstreakString = stats.winstreak?.toString() ?: "?"
        val divisionInfo = stats.wins?.let { DuelsStats.getOverallDivisionInfo(it) }
        val divisionTitle = divisionInfo?.displayName ?: "?"
        val styledDivisionTitle = when {
            divisionInfo == null -> divisionTitle
            divisionInfo.bold -> "§l$divisionTitle"
            else -> divisionTitle
        }
        val divisionLevel = divisionInfo?.romanLevel ?: "?"
        val divisionSymbol = stats.wins?.let { DuelsStats.styleForDivision(it).symbol } ?: "?"
        
        var footerValue = template
        footerValue = footerValue.replace("%wins%", winsString, ignoreCase = true)
        footerValue = footerValue.replace("%losses%", lossesString, ignoreCase = true)
        footerValue = footerValue.replace("%wlr%", wlrString, ignoreCase = true)
        footerValue = footerValue.replace("%kdr%", kdrString, ignoreCase = true)
        footerValue = footerValue.replace("%ws%", winstreakString, ignoreCase = true)
        footerValue = footerValue.replace("%division%", styledDivisionTitle, ignoreCase = true)
        footerValue = footerValue.replace("%divlevel%", divisionLevel, ignoreCase = true)
        footerValue = footerValue.replace("%divsymbol%", divisionSymbol, ignoreCase = true)
        
        val duelsMode = LevelheadConfig.DuelsStatMode.entries.getOrNull(LevelheadConfig.duelsStatDisplayIndex)
            ?: LevelheadConfig.DuelsStatMode.DIVISION_TITLE
        val usesDivisionColor = duelsMode == LevelheadConfig.DuelsStatMode.DIVISION_TITLE ||
            duelsMode == LevelheadConfig.DuelsStatMode.DIVISION_SYMBOL ||
            (duelsMode == LevelheadConfig.DuelsStatMode.CUSTOM && template.contains("%division%", ignoreCase = true))
        val color = if (usesDivisionColor) (divisionInfo?.color ?: config.footerColor) else config.footerColor
        return Triple(footerValue, color, false)
    }
    
    /**
     * Format SkyWars stats.
     * Uses levelInt for display (integer only) while preserving Double precision internally.
     */
    private fun formatSkyWarsStats(
        stats: GameStats.SkyWars,
        template: String,
        config: DisplayConfig
    ): Triple<String, Color, Boolean> {
        val levelValue = stats.levelInt
        val starString = levelValue.let { "$it${SkyWarsStats.getDefaultEmblem(it)}" } ?: "?"
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

        val style = levelValue?.let { SkyWarsStats.getPrestigeStyle(it) }
        val color = style?.color ?: config.footerColor

        return Triple(footerValue, color, false)
    }
}
