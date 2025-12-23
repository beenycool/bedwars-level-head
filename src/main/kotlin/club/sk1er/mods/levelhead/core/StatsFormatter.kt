package club.sk1er.mods.levelhead.core

import club.sk1er.mods.levelhead.config.DisplayConfig
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
        val footerTemplate = config.footerString?.takeIf { it.isNotBlank() } ?: gameMode.statFormat
        
        val (footerValue, footerColor, chroma) = when (stats) {
            is GameStats.Bedwars -> formatBedwarsStats(stats, footerTemplate, config)
            is GameStats.Duels -> formatDuelsStats(stats, footerTemplate, config)
            is GameStats.SkyWars -> formatSkyWarsStats(stats, footerTemplate, config)
            null -> Triple("?", config.footerColor, false)
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
        
        var footerValue = template
        footerValue = footerValue.replace("%wins%", winsString, ignoreCase = true)
        footerValue = footerValue.replace("%losses%", lossesString, ignoreCase = true)
        footerValue = footerValue.replace("%wlr%", wlrString, ignoreCase = true)
        footerValue = footerValue.replace("%kdr%", kdrString, ignoreCase = true)
        footerValue = footerValue.replace("%ws%", winstreakString, ignoreCase = true)
        
        val style = stats.wins?.let { DuelsStats.styleForDivision(it) }
            ?: DuelsStats.DivisionStyle(config.footerColor, "✧")
        
        return Triple(footerValue, style.color, false)
    }
    
    /**
     * Format SkyWars stats.
     */
    private fun formatSkyWarsStats(
        stats: GameStats.SkyWars,
        template: String,
        config: DisplayConfig
    ): Triple<String, Color, Boolean> {
        val levelValue = stats.level
        val starString = levelValue?.let { "$it${SkyWarsStats.getStarSymbol(it)}" } ?: "?"
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
