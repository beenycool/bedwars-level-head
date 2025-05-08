package club.sk1er.mods.levelhead.core

import club.sk1er.mods.levelhead.Levelhead
import gg.essential.api.EssentialAPI
import gg.essential.universal.UMinecraft
import net.minecraft.scoreboard.ScoreObjective
import java.util.regex.Pattern

/**
 * Detects if the player is currently in a Bedwars game
 */
object BedwarsDetector {
    private val BEDWARS_SCOREBOARD_PATTERN = Pattern.compile("(?i)(bed ?wars|bw)")
    private val BEDWARS_MODE_PATTERN = Pattern.compile("(?i)\\bbed ?wars\\b")
    private val LOBBY_PATTERN = Pattern.compile("(?i)(lobby|waiting|queue)")
    
    /**
     * Determines if the player is in a Bedwars game
     * @return true if in Bedwars game (not lobby), false otherwise
     */
    fun isInBedwarsGame(): Boolean {
        // Only works on Hypixel
        if (!EssentialAPI.getMinecraftUtil().isHypixel()) {
            return false
        }
        
        // If user doesn't want to restrict to Bedwars only, return true
        if (!Levelhead.displayManager.config.onlyInBedwars) {
            return true
        }
        
        val scoreboard = UMinecraft.getPlayer()?.worldScoreboard ?: return false
        val sidebarObjective = scoreboard.getObjectiveInDisplaySlot(1) ?: return false
        
        // Check if it's a Bedwars scoreboard
        if (!isBedwarsScoreboard(sidebarObjective)) {
            return false
        }
        
        // Check if we're in a lobby or actual game
        return !isInLobby(scoreboard, sidebarObjective)
    }
    
    /**
     * Determines if the current scoreboard is for Bedwars
     */
    private fun isBedwarsScoreboard(objective: ScoreObjective): Boolean {
        // Check scoreboard title for Bedwars indicators
        val displayName = objective.displayName ?: return false
        return BEDWARS_SCOREBOARD_PATTERN.matcher(displayName).find()
    }
    
    /**
     * Determines if the player is in a lobby or waiting room
     * @return true if in lobby, false if in game
     */
    private fun isInLobby(scoreboard: net.minecraft.scoreboard.Scoreboard, objective: ScoreObjective): Boolean {
        // Check if any score line contains lobby indicators
        val scoreCollection = scoreboard.getSortedScores(objective)
        
        for (score in scoreCollection) {
            val entry = score.playerName ?: continue
            val team = scoreboard.getPlayersTeam(entry)
            val text = team?.formatString(entry) ?: entry
            
            if (LOBBY_PATTERN.matcher(text).find()) {
                return true  // In a lobby
            }
        }
        
        return false
    }
}