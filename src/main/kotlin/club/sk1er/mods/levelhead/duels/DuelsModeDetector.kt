package club.sk1er.mods.levelhead.duels

import club.sk1er.mods.levelhead.Levelhead
import club.sk1er.mods.levelhead.core.BedwarsModeDetector
import club.sk1er.mods.levelhead.skywars.SkyWarsModeDetector
import net.minecraft.client.Minecraft
import net.minecraft.scoreboard.Score
import net.minecraft.scoreboard.ScorePlayerTeam
import net.minecraft.util.IChatComponent
import net.minecraft.util.StringUtils
import net.minecraftforge.client.event.ClientChatReceivedEvent
import net.minecraftforge.fml.common.eventhandler.SubscribeEvent
import java.util.Locale

/**
 * Detects when the player is in a Duels game on Hypixel.
 * Similar to BedwarsModeDetector but for Duels game mode.
 */
object DuelsModeDetector {
    private val WHITESPACE_PATTERN = Regex("\\s+")

    private var cachedContext: Context = Context.UNKNOWN
    private var lastDetectionTime: Long = 0L
    private var chatDetectedContext: Context = Context.NONE
    private var chatDetectionExpiry: Long = 0L

    private const val CHAT_CONTEXT_DURATION = 20_000L

    private val bedwarsChatIndicators = listOf(
        "protect your bed",
        "bed destruction",
        "your bed was",
        "bed was destroyed",
        "bedwars",
        "bed wars",
        "sending you to mini"
    )

    private val skywarsChatIndicators = listOf(
        "skywars",
        "cages open in",
        "players left:"
    )

    enum class Context {
        UNKNOWN,
        NONE,
        LOBBY,
        MATCH;

        val isDuels: Boolean
            get() = this == LOBBY || this == MATCH
    }

    fun onWorldJoin() {
        cachedContext = Context.UNKNOWN
        lastDetectionTime = 0L
        chatDetectedContext = Context.NONE
        chatDetectionExpiry = 0L
    }

    fun currentContext(force: Boolean = false): Context {
        val now = System.currentTimeMillis()
        // Cache context for 5 seconds to reduce scoreboard parsing overhead
        if (force || cachedContext == Context.UNKNOWN || now - lastDetectionTime > 5_000L) {
            val detected = detectContext()
            if (detected != cachedContext) {
                val oldContext = cachedContext.takeUnless { it == Context.UNKNOWN } ?: Context.NONE
                cachedContext = detected
                if (oldContext != detected) {
                    handleContextChange(oldContext, detected)
                }
            } else if (cachedContext == Context.UNKNOWN) {
                cachedContext = detected
            }
            lastDetectionTime = now
        }
        return cachedContext
    }

    fun isInDuelsLobby(): Boolean = currentContext().let { it == Context.LOBBY }

    fun isInDuelsMatch(): Boolean = currentContext().let { it == Context.MATCH }

    fun isInDuels(): Boolean = currentContext().isDuels

    fun shouldRequestData(): Boolean {
        return Levelhead.isOnHypixel() && isInDuelsMatch()
    }

    fun shouldRenderTags(): Boolean {
        currentContext()
        return shouldRequestData()
    }

    private fun handleContextChange(old: Context, new: Context) {
        when {
            !old.isDuels && new.isDuels -> {
                Levelhead.displayManager.syncGameMode()
                Levelhead.displayManager.requestAllDisplays()
            }
            old.isDuels && !new.isDuels -> {
                Levelhead.displayManager.clearCachesWithoutRefetch(false)
            }
        }
    }

    private fun detectContext(): Context {
        val isInBedwars = BedwarsModeDetector.isInBedwars()
        val isInSkywars = SkyWarsModeDetector.isInSkyWars()
        Levelhead.logger.debug("detectContext: isInBedwars={} isInSkywars={}", isInBedwars, isInSkywars)
        
        if (isInBedwars || isInSkywars) {
            Levelhead.logger.debug("detectContext: returning NONE due to Bedwars/SkyWars")
            return Context.NONE
        }

        val scoreboardContext = detectScoreboardContext()
        Levelhead.logger.debug("detectContext: scoreboardContext={}", scoreboardContext)
        
        if (scoreboardContext != null && scoreboardContext != Context.NONE) {
            Levelhead.logger.debug("detectContext: returning scoreboardContext={}", scoreboardContext)
            return scoreboardContext
        }

        if (scoreboardContext == null || isScoreboardTitleGeneric()) {
            val chatContext = currentChatContext()
            Levelhead.logger.debug("detectContext: chatContext={} (scoreboardNull={} titleGeneric={})", 
                chatContext, scoreboardContext == null, isScoreboardTitleGeneric())
            if (chatContext != Context.NONE) {
                Levelhead.logger.debug("detectContext: returning chatContext={}", chatContext)
                return chatContext
            }
        }

        Levelhead.logger.debug("detectContext: returning final {}", scoreboardContext ?: Context.NONE)
        return scoreboardContext ?: Context.NONE
    }

    private fun isScoreboardTitleGeneric(): Boolean {
        val mc = Minecraft.getMinecraft()
        val world = mc.theWorld ?: return true
        val scoreboard = world.scoreboard ?: return true
        val objective = scoreboard.getObjectiveInDisplaySlot(1) ?: return true

        val rawTitle = objective.displayName?.let {
            StringUtils.stripControlCodes(it)
        } ?: ""
        val title = rawTitle.uppercase(Locale.ROOT).replace(WHITESPACE_PATTERN, "")
        
        return title == "HYPIXEL" || title == "PROTOTYPE" || title.isBlank()
    }

    private fun detectScoreboardContext(): Context? {
        val mc = Minecraft.getMinecraft()
        val world = mc.theWorld ?: run {
            Levelhead.logger.debug("detectScoreboardContext: world is null, returning null")
            return null
        }
        val scoreboard = world.scoreboard ?: run {
            Levelhead.logger.debug("detectScoreboardContext: scoreboard is null, returning null")
            return null
        }
        val objective = scoreboard.getObjectiveInDisplaySlot(1) ?: run {
            Levelhead.logger.debug("detectScoreboardContext: objective is null, returning null")
            return null
        }

        val rawTitle = objective.displayName?.let {
            StringUtils.stripControlCodes(it)
        } ?: ""
        val title = rawTitle.uppercase(Locale.ROOT)
        val normalizedTitle = title.replace(WHITESPACE_PATTERN, "")
        
        Levelhead.logger.debug("detectScoreboardContext: title='{}' normalized='{}'", rawTitle, normalizedTitle)
        
        // If the title explicitly says BEDWARS or SKYWARS, we let those detectors handle it
        if (normalizedTitle.contains("BEDWARS") || normalizedTitle.contains("SKYWARS")) {
            Levelhead.logger.debug("detectScoreboardContext: title contains BEDWARS/SKYWARS, returning NONE")
            return Context.NONE
        }
        
        val lines = scoreboard.getSortedScores(objective)
            .asSequence()
            .filterNot { score ->
                score.playerName == null || score.playerName.startsWith("#")
            }
            .map { score -> formatScoreLine(score, scoreboard) }
            .filter { it.isNotBlank() }
            .toList()

        if (Levelhead.logger.isDebugEnabled) {
            Levelhead.logger.debug("detectScoreboardContext: lines={} content={}", lines.size, lines.take(10).joinToString(" | "))
        }

        val normalizedLines = lines.map { it.uppercase(Locale.ROOT) }
        val isBedwarsDuels = normalizedLines.any { line ->
            line.contains("BED WARS") ||
                line.contains("BEDS:") ||
                line.contains("BEDS BROKEN") ||
                line.contains("FINAL KILLS") ||
                line.contains("EMERALDS IN") ||
                line.contains("DIAMONDS IN")
        }

        if (isBedwarsDuels) {
            Levelhead.logger.debug("detectScoreboardContext: isBedwarsDuels=true, returning NONE")
            return Context.NONE
        }

        val isDuelScoreboard = normalizedTitle.contains("DUELS") || lines.any { it.contains("Duel", ignoreCase = true) }
        Levelhead.logger.debug("detectScoreboardContext: isDuelScoreboard={} (titleHasDUELS={} linesHaveDuel={})", 
            isDuelScoreboard, normalizedTitle.contains("DUELS"), lines.any { it.contains("Duel", ignoreCase = true) })
        
        if (!isDuelScoreboard) {
            Levelhead.logger.debug("detectScoreboardContext: not detected as Duels scoreboard, returning NONE")
            return Context.NONE
        }

        // In Duels, only use strong in-match indicators.
        // Lobby scoreboards can include lifetime stat lines (for example "Kills:"),
        // so those should not be treated as match context.
        val matchIndicators = lines.any { 
            it.contains("Opponent:", ignoreCase = true) || 
            it.contains("Time Left:", ignoreCase = true) ||
            it.contains("Health:", ignoreCase = true) ||
            it.contains("Round:", ignoreCase = true)
        }
        Levelhead.logger.debug("detectScoreboardContext: matchIndicators={}", matchIndicators)
        
        val preGameIndicators = lines.any {
            it.contains("Starting in", ignoreCase = true) ||
            it.contains("Players:", ignoreCase = true) ||
            it.contains("Mode:", ignoreCase = true)
        }
        Levelhead.logger.debug("detectScoreboardContext: preGameIndicators={}", preGameIndicators)

        val mainLobbyIndicators = lines.any {
            (it.contains("Wins:", ignoreCase = true) && !it.contains("Opponent:", ignoreCase = true)) ||
            it.contains("Losses:", ignoreCase = true) ||
            it.contains("Winstreak", ignoreCase = true) ||
            it.contains("Coins:", ignoreCase = true) ||
            it.contains("Tokens:", ignoreCase = true)
        }
        Levelhead.logger.debug("detectScoreboardContext: mainLobbyIndicators={}", mainLobbyIndicators)

        if (matchIndicators) {
            Levelhead.logger.debug("detectScoreboardContext: returning MATCH")
            return Context.MATCH
        }

        if (preGameIndicators || mainLobbyIndicators) {
            Levelhead.logger.debug("detectScoreboardContext: returning LOBBY")
            return Context.LOBBY
        }

        Levelhead.logger.debug("detectScoreboardContext: falling through to NONE")
        return Context.NONE
    }

    private fun formatScoreLine(score: Score, scoreboard: net.minecraft.scoreboard.Scoreboard): String {
        val playerName = score.playerName
        val team = scoreboard.getPlayersTeam(playerName)
        val formatted = ScorePlayerTeam.formatPlayerName(team, playerName)
        return StringUtils.stripControlCodes(formatted)
    }

    private fun currentChatContext(): Context {
        val now = System.currentTimeMillis()
        if (chatDetectedContext == Context.NONE) {
            return Context.NONE
        }
        if (now > chatDetectionExpiry) {
            chatDetectedContext = Context.NONE
            chatDetectionExpiry = 0L
            return Context.NONE
        }
        return chatDetectedContext
    }

    private fun recordChatDetection(context: Context) {
        if (context == Context.NONE) {
            return
        }
        val now = System.currentTimeMillis()
        if (context == Context.MATCH || chatDetectedContext != Context.MATCH) {
            chatDetectedContext = context
        }
        chatDetectionExpiry = now + CHAT_CONTEXT_DURATION
        currentContext(force = true)
    }

    private fun clearCachedContext() {
        chatDetectedContext = Context.NONE
        chatDetectionExpiry = 0L
        if (cachedContext.isDuels) {
            cachedContext = Context.NONE
            lastDetectionTime = 0L
            currentContext(force = true)
        }
    }

    @SubscribeEvent
    fun onChat(event: ClientChatReceivedEvent) {
        if (!Levelhead.isOnHypixel()) {
            return
        }
        val message = event.message ?: return
        val rawText = message.unformattedText
        if (rawText.isBlank()) {
            return
        }

        val normalized = StringUtils.stripControlCodes(rawText).lowercase(Locale.ROOT)

        val sawBedwarsSignal = bedwarsChatIndicators.any { normalized.contains(it) }
        val sawSkyWarsSignal = skywarsChatIndicators.any { normalized.contains(it) }
        if (sawBedwarsSignal || sawSkyWarsSignal) {
            clearCachedContext()
            return
        }

        if (normalized.contains("bed wars duels") || normalized.contains("bedwars duels")) {
            // Hypixel "Bed Wars Duels" should stay on BedWars mode semantics.
            // Clear any stale Duels chat context so mode arbitration cannot stick to DUELS.
            clearCachedContext()
            return
        }

        val detectedContext = when {
            normalized.contains("duel starting in") -> Context.MATCH
            normalized.contains("the game starts in") && (normalized.contains("duels") || normalized.contains("duel")) -> Context.MATCH
            normalized.contains("opponent:") -> Context.MATCH
            normalized.contains("you are now queued for") -> Context.LOBBY
            normalized.contains("duels") && normalized.contains("click to play") -> Context.LOBBY
            else -> Context.NONE
        }

        if (detectedContext != Context.NONE) {
            recordChatDetection(detectedContext)
        }
    }
}
