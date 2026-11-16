package club.sk1er.mods.levelhead.core

import net.minecraft.scoreboard.IScoreObjectiveCriteria
import net.minecraft.scoreboard.Scoreboard
import net.minecraft.util.ChatComponentText
import net.minecraftforge.client.event.ClientChatReceivedEvent
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.util.UUID

/**
 * Drives [ModeTracker] with a fake clock and a real scoreboard fixture. Pins the
 * properties the old side-effecting getters could not offer: hysteresis, a world
 * epoch, a visible-UUID snapshot on transitions, and side-effect-free reads.
 */
class ModeTrackerTest {

    private var now = 1_000_000L
    private var scoreboard: Scoreboard? = null
    private val requests = mutableListOf<List<UUID>>()
    private var clears = 0
    private val playerId: UUID = UUID.randomUUID()

    private fun tracker() = ModeTracker(
        scoreboardProvider = { scoreboard },
        isOnHypixel = { true },
        visiblePlayerIds = { listOf(playerId) },
        onRequestAllDisplays = { requests.add(it) },
        onClearDisplays = { clears += 1 },
        clock = { now }
    )

    private fun sidebar(title: String, vararg lines: String): Scoreboard {
        val board = Scoreboard()
        val objective = board.addScoreObjective("sidebar", IScoreObjectiveCriteria.DUMMY)
        objective.displayName = title
        board.setObjectiveInDisplaySlot(1, objective)
        lines.forEach { board.getValueFromObjective(it, objective) }
        return board
    }

    private fun duelsMatch(): Scoreboard = sidebar(
        "§e§lDUELS",
        "§7Mode: §aSumo",
        "§7Opponent: §fRival",
        "§7Time Left: §a2:31",
    )

    private fun bedwarsLobby(): Scoreboard = sidebar(
        "§e§lBED WARS",
        "§7Waiting for players...",
        "§7Players: §f1/16",
        "§7Map: §fAquarium",
    )

    private fun bedwarsMatch(): Scoreboard = sidebar(
        "§e§lBED WARS",
        "§cRed: §fPlayer",
        "§7Beds: §f2",
    )

    @Test
    fun `a mode change needs two consecutive samples, in both directions`() {
        scoreboard = duelsMatch()
        val tracker = tracker()

        tracker.sample(now)
        assertNull(tracker.mode, "first sighting is not yet committed")
        assertTrue(requests.isEmpty(), "the first sighting must not request before the mode is committed")
        assertEquals(0, clears, "the first sighting must not clear anything")

        now += 100
        tracker.sample(now)
        assertEquals(GameMode.DUELS, tracker.mode, "second sighting commits the mode")
        assertEquals(1, requests.size, "committing the mode requests the visible players")
        assertEquals(listOf(playerId), requests.first())

        // The same hysteresis applies when the sidebar goes blank: a scoreboard
        // packet update must not clear the display on its own.
        scoreboard = null
        now += 100
        tracker.sample(now)
        assertEquals(GameMode.DUELS, tracker.mode, "one blank sample must not clear the display")
        assertEquals(ModeContext.MATCH, tracker.context, "one blank sample must not change the context")
        assertEquals(0, clears, "one blank sample must not clear displays")

        now += 100
        tracker.sample(now)
        assertNull(tracker.mode, "second blank sample clears the mode")
        assertEquals(ModeContext.NONE, tracker.context)
        assertEquals(1, clears, "two blank samples clear displays exactly once")
    }

    @Test
    fun `a lobby to match context transition requests displays`() {
        scoreboard = bedwarsLobby()
        val tracker = tracker()

        tracker.sample(now)
        tracker.sample(now)
        assertEquals(GameMode.BEDWARS, tracker.mode)
        assertEquals(ModeContext.LOBBY, tracker.context)
        val requestsAfterJoin = requests.size
        assertEquals(1, requestsAfterJoin)

        scoreboard = bedwarsMatch()
        now += 100
        tracker.sample(now)

        assertEquals(GameMode.BEDWARS, tracker.mode)
        assertEquals(ModeContext.MATCH, tracker.context)
        assertEquals(
            requestsAfterJoin + 1,
            requests.size,
            "entering MATCH in the same game requests displays once"
        )
        assertEquals(0, clears)
    }

    @Test
    fun `world join starts a new epoch and resets the mode`() {
        scoreboard = duelsMatch()
        val tracker = tracker()
        tracker.sample(now)
        tracker.sample(now)
        val before = tracker.worldEpoch

        tracker.onWorldJoin()

        assertEquals(before + 1, tracker.worldEpoch)
        assertNull(tracker.mode)
        assertEquals(ModeContext.NONE, tracker.context)
    }

    @Test
    fun `world join does not clear the stats store`() {
        val store = StatsStore(maxSizeProvider = { 16 }, ttlProvider = { java.time.Duration.ofMinutes(30) })
        val stats = GameStats.Bedwars(123, 1.23, false, now)
        store.putSuccess(playerId, GameMode.BEDWARS, stats)

        val tracker = tracker()
        tracker.onWorldJoin()

        assertEquals(stats, store.get(playerId, GameMode.BEDWARS))
    }

    @Test
    fun `reads have no side effects`() {
        scoreboard = duelsMatch()
        val tracker = tracker()
        tracker.sample(now)
        tracker.sample(now)
        val requestsAfterTransition = requests.size
        val clearsAfterTransition = clears

        repeat(10) {
            tracker.mode
            tracker.context
            tracker.worldEpoch
        }

        assertEquals(requestsAfterTransition, requests.size)
        assertEquals(clearsAfterTransition, clears)
    }

    @Test
    fun `transitions hand the main-thread visible snapshot to the queue`() {
        scoreboard = duelsMatch()
        val tracker = tracker()

        tracker.sample(now)

        assertTrue(requests.isEmpty(), "the uncommitted first sample must not reach the queue")

        tracker.sample(now)

        assertTrue(requests.isNotEmpty())
        assertEquals(listOf(playerId), requests.first())
    }

    @Test
    fun `leaving a match clears displays once`() {
        scoreboard = duelsMatch()
        val tracker = tracker()
        tracker.sample(now)
        tracker.sample(now)
        assertEquals(0, clears)

        scoreboard = null
        now += 100
        tracker.sample(now)

        assertEquals(0, clears, "the first blank sample must not defeat hysteresis")

        now += 100
        tracker.sample(now)

        assertEquals(1, clears, "the second blank sample clears displays exactly once")
    }

    @Test
    fun `chat is an explicit event and commits immediately`() {
        scoreboard = null
        val tracker = tracker()

        tracker.onChat(ClientChatReceivedEvent(0.toByte(), ChatComponentText("Opponent: Rival")))

        assertEquals(GameMode.DUELS, tracker.mode)
        assertEquals(ModeContext.MATCH, tracker.context)
    }

    @Test
    fun `chat is ignored outside hypixel`() {
        scoreboard = null
        val tracker = ModeTracker(
            scoreboardProvider = { scoreboard },
            isOnHypixel = { false },
            visiblePlayerIds = { emptyList() },
            clock = { now }
        )

        tracker.onChat(ClientChatReceivedEvent(0.toByte(), ChatComponentText("Opponent: Rival")))

        assertNull(tracker.mode)
    }
}
