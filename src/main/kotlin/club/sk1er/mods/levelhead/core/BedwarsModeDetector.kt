package club.sk1er.mods.levelhead.core

import club.sk1er.mods.levelhead.Levelhead
import net.minecraft.client.Minecraft
import net.minecraft.util.StringUtils
import net.minecraftforge.client.event.ClientChatReceivedEvent
import net.minecraftforge.fml.common.eventhandler.SubscribeEvent
import java.util.Locale

object BedwarsModeDetector : BaseModeDetector() {
    @Deprecated("Use GameMode.BEDWARS.typeId instead", ReplaceWith("GameMode.BEDWARS.typeId"))
    const val BEDWARS_STAR_TYPE = "BEDWARS_STAR"
    @Deprecated("Use GameMode.BEDWARS.defaultHeader instead", ReplaceWith("GameMode.BEDWARS.defaultHeader"))
    const val DEFAULT_HEADER = "BedWars Star"

    private val teamPattern = Regex("""(?:^|\s)(RED|BLUE|GREEN|YELLOW|AQUA|WHITE|PINK|GRAY|GREY)\s*:""", RegexOption.IGNORE_CASE)
    private val miniServerPattern = Regex("""mini\w+""", RegexOption.IGNORE_CASE)
    private val bedwarsIntroPattern = Regex("""protect\s+your\s+bed\s+and\s+destroy\s+the\s+enemy\s+beds?""", RegexOption.IGNORE_CASE)

    private var lastBedwarsDetectedAt: Long = 0L
    private const val TEMP_DEBUG = false
    private const val BEDWARS_CONTEXT_GRACE_MS = 10_000L

    override fun onWorldJoin() {
        super.onWorldJoin()
        lastBedwarsDetectedAt = 0L
    }

    fun isInBedwarsLobby(): Boolean = currentContext().let { it == Context.LOBBY }

    fun isInBedwarsMatch(scoreboardOnly: Boolean = false): Boolean {
        if (scoreboardOnly) {
            return detectScoreboardContext() == Context.MATCH
        }
        return currentContext().let { it == Context.MATCH }
    }

    fun isInBedwarsScoreboard(): Boolean = detectScoreboardContext() == Context.MATCH

    fun isInBedwars(): Boolean = currentContext().isBedwars

    fun peekIsInBedwars(): Boolean = peekContext().isBedwars

    fun shouldRequestData(): Boolean {
        return Levelhead.isOnHypixel() && isInBedwarsMatch()
    }

    fun shouldRenderTags(): Boolean {
        currentContext()
        return Levelhead.isOnHypixel() && isInBedwars()
    }

    override fun handleContextChange(old: Context, new: Context) {
        debug("context change: old=$old new=$new lastBedwarsDetectedAt=$lastBedwarsDetectedAt")
        when {
            !old.isBedwars && new.isBedwars -> Levelhead.displayManager.requestAllDisplays()
            old.isBedwars && !new.isBedwars -> Levelhead.displayManager.clearCachesWithoutRefetch(false)
        }
    }

    override fun detectContext(): Context {
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

        val currentTitle = objective.displayName ?: ""
        val scores = scoreboard.getSortedScores(objective)

        var currentHash = currentTitle.hashCode()
        if (scores.isNotEmpty()) {
            currentHash = 31 * currentHash + scores.size
            currentHash = 31 * currentHash + (scores.firstOrNull()?.playerName?.hashCode() ?: 0)
        }

        if (currentHash == lastScoreboardHash && lastScoreboardContext != Context.UNKNOWN) {
             return lastScoreboardContext
        }

        val displayComponent: Any? = objective.displayName
        val rawTitle = when (displayComponent) {
            null -> ""
            is net.minecraft.util.IChatComponent -> displayComponent.formattedText
            else -> {
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

        val result = when {
            hasTeamLines -> Context.MATCH
            hasBedwarsTitle || hasBedwarsIndicators -> Context.LOBBY
            else -> Context.NONE
        }

        lastScoreboardHash = currentHash
        lastScoreboardContext = result

        return result
    }

    private fun debug(message: String) {
        if (TEMP_DEBUG) {
            Levelhead.logger.info("[TEMP_DEBUG] $message")
        }
    }

    @SubscribeEvent
    override fun onChat(event: ClientChatReceivedEvent) {
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