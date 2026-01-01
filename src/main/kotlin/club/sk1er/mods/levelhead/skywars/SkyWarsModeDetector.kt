package club.sk1er.mods.levelhead.skywars

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
 * Detects when the player is in a SkyWars game on Hypixel.
 * Similar to BedwarsModeDetector but for SkyWars game mode.
 */
object SkyWarsModeDetector {
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

        val isSkyWars: Boolean
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

    fun isInSkyWarsLobby(): Boolean = currentContext().let { it == Context.LOBBY }

    fun isInSkyWarsMatch(): Boolean = currentContext().let { it == Context.MATCH }

    fun isInSkyWars(): Boolean = currentContext().isSkyWars

    fun shouldRequestData(): Boolean {
        return Levelhead.isOnHypixel() && isInSkyWars()
    }

    fun shouldRenderTags(): Boolean {
        currentContext()
        return shouldRequestData()
    }

    private fun handleContextChange(old: Context, new: Context) {
        when {
            !old.isSkyWars && new.isSkyWars -> {
                Levelhead.displayManager.syncGameMode()
                Levelhead.displayManager.requestAllDisplays()
            }
            old.isSkyWars && !new.isSkyWars -> {
                Levelhead.displayManager.clearCachesWithoutRefetch(false)
            }
        }
    }

    private fun detectContext(): Context {
        val scoreboardContext = detectScoreboardContext()
        if (scoreboardContext != null && scoreboardContext != Context.NONE) {
            return scoreboardContext
        }

        if (scoreboardContext == null || isScoreboardTitleGeneric()) {
            val chatContext = currentChatContext()
            if (chatContext != Context.NONE) {
                return chatContext
            }
        }

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
        val world = mc.theWorld ?: return null
        val scoreboard = world.scoreboard ?: return null
        val objective = scoreboard.getObjectiveInDisplaySlot(1) ?: return null

        val rawTitle = objective.displayName?.let {
            StringUtils.stripControlCodes(it)
        } ?: ""
        val title = rawTitle.uppercase(Locale.ROOT)
        val normalizedTitle = title.replace(WHITESPACE_PATTERN, "")
        if (!normalizedTitle.contains("SKYWARS")) {
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

        // In SkyWars, look for indicators like "Players Left:" or "Kills:"
        // Lobbies usually have "Coins:" or "Tokens:"
        val matchIndicators = lines.any {
            it.contains("Players Left:", ignoreCase = true) ||
            it.contains("Kills:", ignoreCase = true) ||
            it.contains("Next Event:", ignoreCase = true) ||
            it.contains("Time Left:", ignoreCase = true) ||
            it.contains("Cages Open in", ignoreCase = true)
        }
        
        val preGameIndicators = lines.any {
            it.contains("Starting in", ignoreCase = true) ||
            it.contains("Players:", ignoreCase = true) ||
            it.contains("Map:", ignoreCase = true) ||
            it.contains("Mode:", ignoreCase = true)
        }

        val mainLobbyIndicators = lines.any {
            it.contains("Coins:", ignoreCase = true) ||
            it.contains("Tokens:", ignoreCase = true) ||
            it.contains("Soul Well", ignoreCase = true)
        }

        if (matchIndicators) {
            return Context.MATCH
        }
        
        if (preGameIndicators && !mainLobbyIndicators) {
            return Context.LOBBY
        }

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
            normalized.contains("the game starts in") && normalized.contains("second") && normalized.contains("skywars") -> Context.MATCH
            normalized.contains("cages open in") -> Context.MATCH
            normalized.contains("you died!") && normalized.contains("skywars") -> Context.MATCH
            normalized.contains("skywars") && normalized.contains("click to play") -> Context.LOBBY
            else -> Context.NONE
        }

        if (detectedContext != Context.NONE) {
            recordChatDetection(detectedContext)
        }
    }
}
