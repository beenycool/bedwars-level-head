package club.sk1er.mods.levelhead.core

import club.sk1er.mods.levelhead.Levelhead
import net.minecraft.client.Minecraft
import net.minecraft.scoreboard.Score
import net.minecraft.scoreboard.ScorePlayerTeam
import net.minecraft.util.IChatComponent
import net.minecraft.util.StringUtils
import net.minecraftforge.client.event.ClientChatReceivedEvent
import net.minecraftforge.fml.common.eventhandler.SubscribeEvent
import java.util.Locale

object BedwarsModeDetector {
    // Legacy constants - kept for backward compatibility
    @Deprecated("Use GameMode.BEDWARS.typeId instead", ReplaceWith("GameMode.BEDWARS.typeId"))
    const val BEDWARS_STAR_TYPE = "BEDWARS_STAR"
    @Deprecated("Use GameMode.BEDWARS.defaultHeader instead", ReplaceWith("GameMode.BEDWARS.defaultHeader"))
    const val DEFAULT_HEADER = "BedWars Star"

    private val teamPattern = Regex("(?:^|\\s)(RED|BLUE|GREEN|YELLOW|AQUA|WHITE|PINK|GRAY|GREY)\\s*:", RegexOption.IGNORE_CASE)
    private val miniServerPattern = Regex("mini\\w+", RegexOption.IGNORE_CASE)
    private val bedwarsIntroPattern = Regex("protect\\s+your\\s+bed\\s+and\\s+destroy\\s+the\\s+enemy\\s+beds?", RegexOption.IGNORE_CASE)
    private val WHITESPACE_PATTERN = Regex("\\s+")

    private var cachedContext: Context = Context.UNKNOWN
    private var lastDetectionTime: Long = 0L
    private var chatDetectedContext: Context = Context.NONE
    private var chatDetectionExpiry: Long = 0L
    private var lastBedwarsDetectedAt: Long = 0L

    // Optimization: Cache previous scoreboard hash
    private var lastScoreboardHash: Int = 0

    private const val TEMP_DEBUG = false
    private const val CHAT_CONTEXT_DURATION = 20_000L
    private const val BEDWARS_CONTEXT_GRACE_MS = 10_000L

    enum class Context {
        UNKNOWN,
        NONE,
        LOBBY,
        MATCH;

        val isBedwars: Boolean
            get() = this == LOBBY || this == MATCH
    }

    fun onWorldJoin() {
        cachedContext = Context.UNKNOWN
        lastDetectionTime = 0L
        chatDetectedContext = Context.NONE
        chatDetectionExpiry = 0L
        lastBedwarsDetectedAt = 0L
        lastScoreboardHash = 0
    }

    fun currentContext(force: Boolean = false): Context {
        val now = System.currentTimeMillis()
        // Cache context for 5 seconds to reduce scoreboard parsing overhead
        if (force || cachedContext == Context.UNKNOWN || now - lastDetectionTime > 5_000L) {
            val detected = detectContext()
            if (detected != cachedContext) {
                val oldContext = cachedContext.takeUnless { it == Context.UNKNOWN } ?: Context.NONE
                cachedContext = detected
                handleContextChange(oldContext, detected)
            } else if (cachedContext == Context.UNKNOWN) {
                cachedContext = detected
            }
            lastDetectionTime = now
        }
        return cachedContext
    }

    fun isInBedwarsLobby(): Boolean = currentContext().let { it == Context.LOBBY }

    fun isInBedwarsMatch(): Boolean = currentContext().let { it == Context.MATCH }

    fun isInBedwars(): Boolean = currentContext().isBedwars

    fun shouldRequestData(): Boolean {
        return Levelhead.isOnHypixel() && isInBedwarsMatch()
    }

    fun shouldRenderTags(): Boolean {
        currentContext()
        return Levelhead.isOnHypixel() && isInBedwars()
    }

    private fun handleContextChange(old: Context, new: Context) {
        debug("context change: old=$old new=$new lastBedwarsDetectedAt=$lastBedwarsDetectedAt")
        when {
            !old.isBedwars && new.isBedwars -> Levelhead.displayManager.requestAllDisplays()
            old.isBedwars && !new.isBedwars -> Levelhead.displayManager.clearCachesWithoutRefetch(false)
        }
    }

    private fun detectContext(): Context {
        val now = System.currentTimeMillis()
        val scoreboardContext = detectScoreboardContext()
        if (scoreboardContext != null && scoreboardContext != Context.NONE) {
            lastBedwarsDetectedAt = now
            debug("detectContext scoreboard hit: $scoreboardContext lastBedwarsDetectedAt=$lastBedwarsDetectedAt")
            return scoreboardContext
        }

        val chatContext = currentChatContext()
        if (chatContext != Context.NONE) {
            lastBedwarsDetectedAt = now
            debug("detectContext chat hit: $chatContext lastBedwarsDetectedAt=$lastBedwarsDetectedAt")
            return chatContext
        }

        if (cachedContext.isBedwars && now - lastBedwarsDetectedAt < BEDWARS_CONTEXT_GRACE_MS) {
            debug("detectContext grace keep: cached=$cachedContext age=${now - lastBedwarsDetectedAt}ms")
            return cachedContext
        }

        debug("detectContext fallback: cached=$cachedContext scoreboard=$scoreboardContext chat=$chatContext")
        return scoreboardContext ?: Context.NONE
    }

    private fun detectScoreboardContext(): Context? {
        val mc = Minecraft.getMinecraft()
        val world = mc.theWorld ?: run {
            debug("scoreboard missing: world=null")
            return null
        }
        val scoreboard = world.scoreboard ?: run {
            debug("scoreboard missing: scoreboard=null")
            return null
        }
        val objective = scoreboard.getObjectiveInDisplaySlot(1) ?: run {
            debug("scoreboard missing: objective=null")
            return null
        }

        // Optimization: Quick check if scoreboard content changed
        val currentTitle = objective.displayName ?: ""
        val scores = scoreboard.getSortedScores(objective)

        // Simple hash of title + count + first/last score to detect changes cheaply
        // Not perfect but good enough for interval checks
        var currentHash = currentTitle.hashCode()
        if (scores.isNotEmpty()) {
            currentHash = 31 * currentHash + scores.size
            currentHash = 31 * currentHash + (scores.firstOrNull()?.playerName?.hashCode() ?: 0)
        }

        // If hash matches and we have a valid cached context, reuse it (unless it's UNKNOWN)
        if (currentHash == lastScoreboardHash && cachedContext != Context.UNKNOWN) {
             // If the cached context was derived from scoreboard, we can return it.
             // But detectContext logic might fall back to chat/grace if this returns null/NONE.
             // We return null here to indicate "no new info", but logic above handles it.
             // Actually, if we want to reuse the result of *this specific detection method*,
             // we need to know what it was last time.
             // Simpler approach: if hash matches, assume context hasn't changed from scoreboard perspective.
             // However, context also depends on chat.
             // Let's just proceed for now, the regex overhead is the main target.
        }

        lastScoreboardHash = currentHash

        val displayComponent: Any? = objective.displayName
        val rawTitle = when (displayComponent) {
            null -> ""
            is IChatComponent -> displayComponent.formattedText
            else -> {
                // Fallback: try to invoke getFormattedText on the actual type, then fall back to toString()
                runCatching {
                    displayComponent::class.java.getMethod("getFormattedText")
                        .invoke(displayComponent) as? String
                }.getOrNull() ?: displayComponent.toString()
            }
        }
        val title = StringUtils.stripControlCodes(rawTitle)
            .uppercase(Locale.ROOT)
        val normalizedTitle = title.replace(WHITESPACE_PATTERN, "")

        val lines = scoreboard.getSortedScores(objective)
            .asSequence()
            .filterNot { score ->
                score.playerName == null || score.playerName.startsWith("#")
            }
            .map { score -> formatScoreLine(score, scoreboard) }
            .filter { it.isNotBlank() }
            .toList()

        val hasBedwarsTitle = normalizedTitle.contains("BEDWARS")
        val hasTeamLines = lines.any { teamPattern.containsMatchIn(it) }
        val hasBedwarsIndicators = lines.any { line ->
            val normalizedLine = line.uppercase(Locale.ROOT)
            normalizedLine.contains("BEDS BROKEN") ||
                normalizedLine.contains("FINAL KILLS") ||
                normalizedLine.contains("EMERALDS IN") ||
                normalizedLine.contains("DIAMONDS IN") ||
                normalizedLine.contains("BEDS:")
        }

        val sample = lines.take(8).joinToString(" | ")
        debug(
            "scoreboard title='$title' normalized='$normalizedTitle' lines=${lines.size} " +
                "hasTitle=$hasBedwarsTitle hasTeamLines=$hasTeamLines hasIndicators=$hasBedwarsIndicators " +
                "sample='$sample'"
        )

        if (!hasBedwarsTitle && !hasTeamLines && !hasBedwarsIndicators) {
            return Context.NONE
        }

        if (hasTeamLines) {
            return Context.MATCH
        }

        return Context.LOBBY
    }

    private fun debug(message: String) {
        if (TEMP_DEBUG) {
            Levelhead.logger.info("[TEMP_DEBUG] $message")
        }
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
        val hasBedwarsKeyword = normalized.contains("bed wars") || normalized.contains("bedwars")
        val detectedContext = when {
            bedwarsIntroPattern.containsMatchIn(normalized) -> Context.MATCH
            (normalized.contains("the game starts in") || normalized.contains("game starts in")) && hasBedwarsKeyword -> Context.MATCH
            hasBedwarsKeyword -> Context.LOBBY
            normalized.contains("sending you to mini") && cachedContext.isBedwars -> Context.LOBBY
            miniServerPattern.containsMatchIn(normalized) && cachedContext.isBedwars -> Context.LOBBY
            else -> Context.NONE
        }

        if (detectedContext != Context.NONE) {
            recordChatDetection(detectedContext)
        }
    }
}
