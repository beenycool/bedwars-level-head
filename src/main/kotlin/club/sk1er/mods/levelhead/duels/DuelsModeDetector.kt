package club.sk1er.mods.levelhead.duels

import club.sk1er.mods.levelhead.Levelhead
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
                handleContextChange(oldContext, detected)
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
        return Levelhead.isOnHypixel() && isInDuels()
    }

    fun shouldRenderTags(): Boolean {
        currentContext()
        return shouldRequestData()
    }

    private fun handleContextChange(old: Context, new: Context) {
        when {
            !old.isDuels && new.isDuels -> Levelhead.displayManager.requestAllDisplays()
            old.isDuels && !new.isDuels -> Levelhead.displayManager.clearCachesWithoutRefetch()
        }
    }

    private fun detectContext(): Context {
        val scoreboardContext = detectScoreboardContext()
        if (scoreboardContext != null && scoreboardContext != Context.NONE) {
            return scoreboardContext
        }

        val chatContext = currentChatContext()
        if (chatContext != Context.NONE) {
            return chatContext
        }

        return scoreboardContext ?: Context.NONE
    }

    private fun detectScoreboardContext(): Context? {
        val mc = Minecraft.getMinecraft()
        val world = mc.theWorld ?: return null
        val scoreboard = world.scoreboard ?: return null
        val objective = scoreboard.getObjectiveInDisplaySlot(1) ?: return null

        val displayComponent: Any? = objective.displayName
        val rawTitle = when (displayComponent) {
            null -> ""
            is IChatComponent -> displayComponent.formattedText
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
        if (!normalizedTitle.contains("DUELS")) {
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

        // In Duels, look for indicators like "Opponent:" or timer patterns
        if (lines.any { it.contains("Opponent:", ignoreCase = true) || it.contains("Kills:", ignoreCase = true) }) {
            return Context.MATCH
        }

        return Context.LOBBY
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
        val detectedContext = when {
            normalized.contains("duel starting in") -> Context.MATCH
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
