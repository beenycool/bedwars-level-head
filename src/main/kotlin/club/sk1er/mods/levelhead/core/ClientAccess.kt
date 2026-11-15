package club.sk1er.mods.levelhead.core

import club.sk1er.mods.levelhead.config.LevelheadConfig
import net.minecraft.client.Minecraft
import net.minecraft.scoreboard.Scoreboard
import java.util.Locale
import java.util.UUID

/**
 * Test seam around live-client state.
 *
 * Production behaviour is identical to reading [Minecraft] directly. The headless
 * tests replace the providers with real [Scoreboard] fixtures — the scoreboard data
 * classes are plain JVM classes and need no running client — so detection logic can
 * be exercised without launching the game. Keeping the two client reads behind this
 * object means the mode detectors and the Hypixel check never touch the client
 * singleton directly.
 */
object ClientAccess {
    private val defaultScoreboardProvider: () -> Scoreboard? = {
        Minecraft.getMinecraft()?.theWorld?.scoreboard
    }

    private val defaultHypixelServerCheck: () -> Boolean = {
        // The user's force-enable override wins over the address check. It lives
        // here (rather than at the call sites) so production behaviour is
        // unchanged while the headless tests can bypass both.
        if (LevelheadConfig.forceEnabled) {
            true
        } else {
            val mc = Minecraft.getMinecraft()
            when {
                mc == null || mc.isSingleplayer -> false
                else -> mc.currentServerData?.serverIP
                    ?.lowercase(Locale.ROOT)
                    ?.contains("hypixel") == true
            }
        }
    }

    private val defaultVisiblePlayerIds: () -> List<UUID> = {
        Minecraft.getMinecraft()?.theWorld?.playerEntities?.map { it.uniqueID } ?: emptyList()
    }

    /** Current scoreboard, or null when no world/scoreboard is loaded. */
    var scoreboardProvider: () -> Scoreboard? = defaultScoreboardProvider

    /** Whether the current server counts as Hypixel (address check + force-enable). */
    var hypixelServerCheck: () -> Boolean = defaultHypixelServerCheck

    /** Players visible in the current world, snapshotted on the client thread. */
    var visiblePlayerIds: () -> List<UUID> = defaultVisiblePlayerIds

    /** Restores the production providers (used by tests in tear-down). */
    fun reset() {
        scoreboardProvider = defaultScoreboardProvider
        hypixelServerCheck = defaultHypixelServerCheck
        visiblePlayerIds = defaultVisiblePlayerIds
    }
}
