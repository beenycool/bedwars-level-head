package club.sk1er.mods.levelhead.core

import net.minecraft.scoreboard.Score
import net.minecraft.scoreboard.ScorePlayerTeam
import net.minecraft.scoreboard.Scoreboard
import net.minecraft.util.StringUtils
import net.minecraftforge.client.event.ClientChatReceivedEvent
import net.minecraftforge.fml.common.eventhandler.SubscribeEvent
import net.minecraftforge.fml.common.gameevent.TickEvent
import org.apache.logging.log4j.Logger
import java.util.Locale
import java.util.UUID

/**
 * Owns "what game am I in".
 *
 * The old detectors were read through getters that fetched stats and cleared
 * caches. That made every renderer, log line and IO coroutine an unknowing state
 * transition on whatever thread it happened to be on. This tracker is the only
 * writer of mode state, it samples on the client tick (main thread), and every
 * public read is a plain field access.
 *
 * Behaviour preserved from the detectors:
 *  - per-game contexts with the same scoreboard/chat/grace rules;
 *  - a 20 s chat window and a 10 s grace period for BedWars/SkyWars;
 *  - transitions hand the visible UUIDs to the request queue.
 *
 * New here (and deliberately so): a mode change must be seen twice before it is
 * committed. A sidebar that is briefly blank during a scoreboard packet update no
 * longer flips the mode, clears displays and starts a request round.
 */
class ModeTracker(
    private val scoreboardProvider: () -> Scoreboard? = { ClientAccess.scoreboardProvider() },
    private val isOnHypixel: () -> Boolean = { ClientAccess.hypixelServerCheck() },
    private val visiblePlayerIds: () -> List<UUID> = { ClientAccess.visiblePlayerIds() },
    private val onRequestAllDisplays: (List<UUID>) -> Unit = {},
    private val onClearDisplays: () -> Unit = {},
    private val logger: Logger? = null,
    private val clock: () -> Long = System::currentTimeMillis
) {
    private class GameState {
        /** null means UNKNOWN: nothing has been detected for this game yet. */
        var cachedContext: ModeContext? = null
        var chatContext: ModeContext = ModeContext.NONE
        var chatExpiry: Long = 0L
        var lastDetectedAt: Long = 0L

        fun reset() {
            cachedContext = null
            chatContext = ModeContext.NONE
            chatExpiry = 0L
            lastDetectedAt = 0L
        }
    }

    private val states: Map<GameMode, GameState> = GameMode.entries.associateWith { GameState() }

    /** Read-only current game, or null when no supported game is proven. */
    @Volatile
    var mode: GameMode? = null
        private set

    /** Read-only current context of [mode]. */
    @Volatile
    var context: ModeContext = ModeContext.NONE
        private set

    /** Incremented once per world join; queued work from an older epoch is stale. */
    @Volatile
    var worldEpoch: Long = 0L
        private set

    private var tickCounter = 0
    private var pendingResolved: GameMode? = null
    private var hasPending = false
    private var pendingCount = 0

    private var cachedTitle: String? = null
    private var cachedLines: List<String> = emptyList()
    private var cachedEvidence: SidebarEvidence? = null

    /** Reset per-game state and start a new world epoch. Does not clear [StatsStore]. */
    fun onWorldJoin() {
        worldEpoch += 1
        states.values.forEach { it.reset() }
        cachedTitle = null
        cachedLines = emptyList()
        cachedEvidence = null
        mode = null
        context = ModeContext.NONE
        pendingResolved = null
        hasPending = false
        pendingCount = 0
        tickCounter = 0
    }

    /** Force an immediate, main-thread sample. Used by the world-join fallback. */
    fun refreshNow() {
        sample(clock(), force = true)
    }

    /**
     * One detection pass. Public so the hysteresis and epoch rules can be driven
     * from a headless test with a fake clock.
     */
    fun sample(now: Long = clock(), force: Boolean = false) {
        val evidence = readEvidence()

        // Detection order matches the old resolver: Duels, SkyWars, BedWars.
        detectGame(GameMode.DUELS, evidence, now)
        detectGame(GameMode.SKYWARS, evidence, now)
        detectGame(GameMode.BEDWARS, evidence, now)

        updateResolved(resolveMode(evidence), force)
    }

    @SubscribeEvent
    fun onClientTick(event: TickEvent.ClientTickEvent) {
        if (event.phase != TickEvent.Phase.END) return
        tickCounter += 1
        if (tickCounter < SAMPLE_INTERVAL_TICKS) return
        tickCounter = 0
        sample(clock(), force = false)
    }

    @SubscribeEvent
    fun onChat(event: ClientChatReceivedEvent) {
        if (!isOnHypixel()) return
        val message = event.message ?: return
        val rawText = message.unformattedText
        if (rawText.isBlank()) return

        val now = clock()
        val normalized = StringUtils.stripControlCodes(rawText).lowercase(Locale.ROOT)

        applyChat(GameMode.BEDWARS, normalized, now)
        applyChat(GameMode.DUELS, normalized, now)
        applyChat(GameMode.SKYWARS, normalized, now)

        // Chat is an explicit event, not a sample: commit the resolved mode now.
        updateResolved(resolveMode(readEvidence()), force = true)
    }

    private fun applyChat(gameMode: GameMode, normalized: String, now: Long) {
        val state = states.getValue(gameMode)
        val signal = ModeClassifier.chatSignal(
            gameMode,
            normalized,
            cachedContextActive = state.cachedContext?.isActive == true
        )
        when (signal) {
            is ChatSignal.Detect -> recordChatDetection(gameMode, signal.context, now)
            ChatSignal.Clear -> clearCachedContext(gameMode, now)
            ChatSignal.None -> Unit
        }
    }

    private fun recordChatDetection(gameMode: GameMode, context: ModeContext, now: Long) {
        if (context == ModeContext.NONE) return
        val state = states.getValue(gameMode)
        if (context == ModeContext.MATCH || state.chatContext != ModeContext.MATCH) {
            state.chatContext = context
        }
        state.chatExpiry = now + CHAT_CONTEXT_DURATION
        forceDetect(gameMode, now)
    }

    private fun clearCachedContext(gameMode: GameMode, now: Long) {
        val state = states.getValue(gameMode)
        state.chatContext = ModeContext.NONE
        state.chatExpiry = 0L
        if (state.cachedContext?.isActive == true) {
            forceDetect(gameMode, now)
        }
    }

    private fun forceDetect(gameMode: GameMode, now: Long) {
        detectGame(gameMode, readEvidence(), now)
    }

    private fun detectGame(gameMode: GameMode, evidence: SidebarEvidence?, now: Long): ModeContext {
        val state = states.getValue(gameMode)
        val scoreboardContext = evidence?.contextOf(gameMode)

        val detected = when (gameMode) {
            GameMode.BEDWARS -> {
                if (scoreboardContext != null && scoreboardContext != ModeContext.NONE) {
                    state.lastDetectedAt = now
                    scoreboardContext
                } else {
                    val chat = currentChatContext(state, now)
                    when {
                        chat != ModeContext.NONE -> {
                            state.lastDetectedAt = now
                            chat
                        }
                        state.cachedContext?.isActive == true &&
                            now - state.lastDetectedAt < ACTIVE_GRACE_MS -> state.cachedContext!!
                        else -> scoreboardContext ?: ModeContext.NONE
                    }
                }
            }

            GameMode.SKYWARS -> {
                if (scoreboardContext != null && scoreboardContext != ModeContext.NONE) {
                    state.lastDetectedAt = now
                    scoreboardContext
                } else {
                    val chat = if (evidence == null || evidence.titleGeneric) {
                        currentChatContext(state, now)
                    } else {
                        ModeContext.NONE
                    }
                    when {
                        chat != ModeContext.NONE -> {
                            state.lastDetectedAt = now
                            chat
                        }
                        state.cachedContext?.isActive == true &&
                            now - state.lastDetectedAt < ACTIVE_GRACE_MS -> state.cachedContext!!
                        else -> scoreboardContext ?: ModeContext.NONE
                    }
                }
            }

            GameMode.DUELS -> {
                when {
                    scoreboardContext != null && scoreboardContext != ModeContext.NONE -> scoreboardContext
                    // Strong (scoreboard) evidence for another game suppresses
                    // Duels detection; cached/chat contexts can be stale after a
                    // game transfer.
                    evidence != null &&
                        (evidence.bedwars == ModeContext.MATCH ||
                            evidence.skywars == ModeContext.MATCH) -> ModeContext.NONE
                    else -> {
                        val chat = if (evidence == null || evidence.titleGeneric) {
                            currentChatContext(state, now)
                        } else {
                            ModeContext.NONE
                        }
                        if (chat != ModeContext.NONE) chat else scoreboardContext ?: ModeContext.NONE
                    }
                }
            }
        }

        updateContext(gameMode, detected)
        return detected
    }

    private fun updateContext(gameMode: GameMode, detected: ModeContext) {
        val state = states.getValue(gameMode)
        val current = state.cachedContext
        if (current == detected) return

        val old = current ?: ModeContext.NONE
        state.cachedContext = detected
        if (old == detected) return

        logger?.debug("mode transition: {} {} -> {}", gameMode, old, detected)
        when {
            detected == ModeContext.MATCH && old != ModeContext.MATCH -> requestDisplays()
            !old.isActive && detected.isActive -> requestDisplays()
            old.isActive && !detected.isActive -> onClearDisplays()
        }
    }

    private fun requestDisplays() {
        onRequestAllDisplays(visiblePlayerIds())
    }

    private fun currentChatContext(state: GameState, now: Long): ModeContext {
        if (state.chatContext == ModeContext.NONE) return ModeContext.NONE
        if (now > state.chatExpiry) {
            state.chatContext = ModeContext.NONE
            state.chatExpiry = 0L
            return ModeContext.NONE
        }
        return state.chatContext
    }

    private fun resolveMode(evidence: SidebarEvidence?): GameMode? {
        val duels = states.getValue(GameMode.DUELS).cachedContext
        val skywars = states.getValue(GameMode.SKYWARS).cachedContext
        val bedwars = states.getValue(GameMode.BEDWARS).cachedContext

        return when {
            // Step 1: explicit scoreboard evidence, most specific games first.
            evidence?.duels == ModeContext.MATCH -> GameMode.DUELS
            evidence?.skywars == ModeContext.MATCH -> GameMode.SKYWARS
            evidence?.bedwars == ModeContext.MATCH -> GameMode.BEDWARS
            // Step 2: match contexts (chat/cached) take priority over lobby detection.
            duels == ModeContext.MATCH -> GameMode.DUELS
            skywars == ModeContext.MATCH -> GameMode.SKYWARS
            bedwars == ModeContext.MATCH -> GameMode.BEDWARS
            // Step 3: fall back to lobby/general detection.
            duels?.isActive == true -> GameMode.DUELS
            skywars?.isActive == true -> GameMode.SKYWARS
            bedwars?.isActive == true -> GameMode.BEDWARS
            else -> null
        }
    }

    private fun updateResolved(resolved: GameMode?, force: Boolean) {
        if (force) {
            mode = resolved
            context = contextFor(resolved)
            pendingResolved = null
            hasPending = false
            pendingCount = 0
            return
        }

        if (resolved == mode) {
            pendingResolved = null
            hasPending = false
            pendingCount = 0
            context = contextFor(mode)
            return
        }

        if (hasPending && pendingResolved == resolved) {
            pendingCount += 1
        } else {
            pendingResolved = resolved
            hasPending = true
            pendingCount = 1
        }

        if (pendingCount >= HYSTERESIS_SAMPLES) {
            mode = resolved
            pendingResolved = null
            hasPending = false
            pendingCount = 0
        }
        context = contextFor(mode)
    }

    private fun contextFor(gameMode: GameMode?): ModeContext =
        gameMode?.let { states.getValue(it).cachedContext } ?: ModeContext.NONE

    private fun readEvidence(): SidebarEvidence? {
        val sidebar = readSidebar()
        if (sidebar == null) {
            cachedTitle = null
            cachedLines = emptyList()
            cachedEvidence = null
            return null
        }
        val (title, lines) = sidebar
        if (title == cachedTitle && lines == cachedLines) {
            return cachedEvidence
        }
        val evidence = ModeClassifier.classify(title, lines)
        cachedTitle = title
        cachedLines = lines
        cachedEvidence = evidence
        return evidence
    }

    private fun readSidebar(): Pair<String, List<String>>? {
        val scoreboard = scoreboardProvider() ?: return null
        val objective = scoreboard.getObjectiveInDisplaySlot(1) ?: return null

        val title = StringUtils.stripControlCodes(objective.displayName ?: "")
        val lines = scoreboard.getSortedScores(objective)
            .asSequence()
            .filterNot { score -> score.playerName == null || score.playerName.startsWith("#") }
            .map { score -> formatScoreLine(score, scoreboard) }
            .filter { it.isNotBlank() }
            .toList()

        return title to lines
    }

    private fun formatScoreLine(score: Score, scoreboard: Scoreboard): String {
        val playerName = score.playerName
        val team = scoreboard.getPlayersTeam(playerName)
        val formatted = ScorePlayerTeam.formatPlayerName(team, playerName)
        return StringUtils.stripControlCodes(formatted)
    }

    private companion object {
        const val SAMPLE_INTERVAL_TICKS = 10
        const val HYSTERESIS_SAMPLES = 2
        const val CHAT_CONTEXT_DURATION = 20_000L
        const val ACTIVE_GRACE_MS = 10_000L
    }
}
