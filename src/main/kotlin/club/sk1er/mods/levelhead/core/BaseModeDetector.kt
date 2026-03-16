package club.sk1er.mods.levelhead.core

import net.minecraft.client.Minecraft
import net.minecraft.scoreboard.Score
import net.minecraft.scoreboard.ScorePlayerTeam
import net.minecraft.util.IChatComponent
import net.minecraft.util.StringUtils
import net.minecraftforge.client.event.ClientChatReceivedEvent
import net.minecraftforge.fml.common.eventhandler.SubscribeEvent
import java.util.Locale

abstract class BaseModeDetector {
    protected val WHITESPACE_PATTERN = Regex("""\s+""")

    enum class Context {
        UNKNOWN,
        NONE,
        LOBBY,
        MATCH;

        val isBedwars: Boolean
            get() = this == LOBBY || this == MATCH
            
        val isDuels: Boolean
            get() = this == LOBBY || this == MATCH
            
        val isSkyWars: Boolean
            get() = this == LOBBY || this == MATCH
    }

    protected var cachedContext: Context = Context.UNKNOWN
    protected var lastDetectionTime: Long = 0L
    protected var chatDetectedContext: Context = Context.NONE
    protected var chatDetectionExpiry: Long = 0L

    protected var lastScoreboardHash: Int = 0
    protected var lastScoreboardContext: Context = Context.UNKNOWN

    protected val CHAT_CONTEXT_DURATION = 20_000L

    open fun onWorldJoin() {
        cachedContext = Context.UNKNOWN
        lastDetectionTime = 0L
        chatDetectedContext = Context.NONE
        chatDetectionExpiry = 0L
        lastScoreboardHash = 0
        lastScoreboardContext = Context.UNKNOWN
    }

    fun currentContext(force: Boolean = false): Context {
        val now = System.currentTimeMillis()
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

    fun peekContext(): Context = cachedContext

    protected abstract fun handleContextChange(old: Context, new: Context)
    protected abstract fun detectContext(): Context

    protected fun isScoreboardTitleGeneric(): Boolean {
        val mc = Minecraft.getMinecraft()
        val world = mc.theWorld ?: return true
        val scoreboard = world.scoreboard ?: return true
        val objective = scoreboard.getObjectiveInDisplaySlot(1) ?: return true

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
        val title = StringUtils.stripControlCodes(rawTitle).uppercase(Locale.ROOT).replace(WHITESPACE_PATTERN, "")
        
        return title == "HYPIXEL" || title == "PROTOTYPE" || title.isBlank()
    }

    protected fun formatScoreLine(score: Score, scoreboard: net.minecraft.scoreboard.Scoreboard): String {
        val playerName = score.playerName
        val team = scoreboard.getPlayersTeam(playerName)
        val formatted = ScorePlayerTeam.formatPlayerName(team, playerName)
        return StringUtils.stripControlCodes(formatted)
    }

    protected fun currentChatContext(): Context {
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

    protected fun recordChatDetection(context: Context) {
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

    protected fun clearCachedContext(isTargetMode: Boolean) {
        chatDetectedContext = Context.NONE
        chatDetectionExpiry = 0L
        if (isTargetMode) {
            cachedContext = Context.NONE
            lastDetectionTime = 0L
            currentContext(force = true)
        }
    }

    @SubscribeEvent
    abstract fun onChat(event: ClientChatReceivedEvent)
}