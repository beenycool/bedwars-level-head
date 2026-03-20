package club.sk1er.mods.levelhead.skywars

import club.sk1er.mods.levelhead.Levelhead
import club.sk1er.mods.levelhead.core.BaseModeDetector
import net.minecraft.client.Minecraft
import net.minecraft.util.StringUtils
import net.minecraftforge.client.event.ClientChatReceivedEvent
import net.minecraftforge.fml.common.eventhandler.SubscribeEvent
import java.util.Locale

/**
 * Detects when the player is in a SkyWars game on Hypixel.
 * Similar to BedwarsModeDetector but for SkyWars game mode.
 */
object SkyWarsModeDetector : BaseModeDetector() {
    private var lastSkyWarsDetectedAt: Long = 0L
    private const val SKYWARS_CONTEXT_GRACE_MS = 10_000L

    private val bedwarsChatIndicators = listOf(
        "protect your bed",
        "bed destruction",
        "your bed was",
        "bed was destroyed"
    )

    private val duelsChatIndicators = listOf(
        "sumo duel",
        "opponent:",
        "duel -",
        "duels winner",
        "duels killer"
    )

    fun isInSkyWarsLobby(): Boolean = currentContext().let { it == Context.LOBBY }

    fun isInSkyWarsMatch(): Boolean = currentContext().let { it == Context.MATCH }

    fun isInSkyWarsScoreboard(): Boolean = detectScoreboardContext() == Context.MATCH

    fun isInSkyWars(): Boolean = currentContext().isSkyWars

    fun peekIsInSkyWars(): Boolean = peekContext().isSkyWars

    override fun onWorldJoin() {
        super.onWorldJoin()
        lastSkyWarsDetectedAt = 0L
    }

    fun shouldRequestData(): Boolean {
        return Levelhead.isOnHypixel() && isInSkyWars()
    }

    fun shouldRenderTags(): Boolean {
        currentContext()
        return shouldRequestData()
    }

    override fun handleContextChange(old: Context, new: Context) {
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

    override fun detectContext(): Context {
        val now = System.currentTimeMillis()
        val scoreboardContext = detectScoreboardContext()
        if (scoreboardContext != null && scoreboardContext != Context.NONE) {
            lastSkyWarsDetectedAt = now
            return scoreboardContext
        }

        if (scoreboardContext == null || isScoreboardTitleGeneric()) {
            val chatContext = currentChatContext()
            if (chatContext != Context.NONE) {
                lastSkyWarsDetectedAt = now
                return chatContext
            }
        }

        if (cachedContext.isSkyWars && now - lastSkyWarsDetectedAt < SKYWARS_CONTEXT_GRACE_MS) {
            return cachedContext
        }

        return scoreboardContext ?: Context.NONE
    }

    private fun detectScoreboardContext(): Context? {
        val mc = Minecraft.getMinecraft()
        val world = mc.theWorld ?: return null
        val scoreboard = world.scoreboard ?: return null
        val objective = scoreboard.getObjectiveInDisplaySlot(1) ?: return null

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
        val title = StringUtils.stripControlCodes(rawTitle).uppercase(Locale.ROOT)
        val normalizedTitle = title.replace(WHITESPACE_PATTERN, "")
        if (!normalizedTitle.contains("SKYWARS")) {
            lastScoreboardHash = currentHash
            lastScoreboardContext = Context.NONE
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

        val result = if (matchIndicators) {
            Context.MATCH
        } else if (preGameIndicators && !mainLobbyIndicators) {
            Context.LOBBY
        } else {
            Context.NONE
        }

        lastScoreboardHash = currentHash
        lastScoreboardContext = result
        return result
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
        val sawBedwarsSignal = bedwarsChatIndicators.any { normalized.contains(it) }
        val sawDuelsSignal = duelsChatIndicators.any { normalized.contains(it) }
        if (sawBedwarsSignal || sawDuelsSignal) {
            clearCachedContext(cachedContext.isSkyWars)
            return
        }
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