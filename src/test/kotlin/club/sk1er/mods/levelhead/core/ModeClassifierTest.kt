package club.sk1er.mods.levelhead.core

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

/**
 * Table tests for the pure mode rules, driven by the same real sidebar fixtures the
 * old `ModeDetectionTest` used plus the missing hub/pregame cases for each game.
 *
 * Nothing here constructs a client object: `ModeClassifier` takes stripped strings
 * and returns data. Each row of the tables below is one fixture; the assertion
 * message names the row so a failure still points at the exact input.
 */
class ModeClassifierTest {

    private data class SidebarCase(
        val name: String,
        val title: String,
        val lines: List<String>,
        val bedwars: ModeContext = ModeContext.NONE,
        val skywars: ModeContext = ModeContext.NONE,
        val duels: ModeContext = ModeContext.NONE,
        val resolvedGame: GameMode? = null,
        val resolvedContext: ModeContext = ModeContext.NONE,
        val titleGeneric: Boolean? = null,
    )

    private data class ChatCase(
        val name: String,
        val gameMode: GameMode,
        val message: String,
        val cachedContextActive: Boolean = false,
        val expected: ChatSignal,
    )

    private val sidebarCases = listOf(
        // ---- BedWars ------------------------------------------------------------
        SidebarCase(
            name = "BEDWARS hub / Coins line",
            title = "§e§lBED WARS",
            lines = listOf("§7Coins: §f123", "§7Loot Chests", "§7Achievements"),
        ),
        SidebarCase(
            name = "BEDWARS pregame lobby",
            title = "§e§lBED WARS",
            lines = listOf("§7Waiting for players...", "§7Players: 4/16", "§7Mode: Solo"),
            bedwars = ModeContext.LOBBY,
            resolvedGame = GameMode.BEDWARS,
            resolvedContext = ModeContext.LOBBY,
        ),
        SidebarCase(
            name = "BEDWARS match",
            title = "§e§lBED WARS",
            lines = listOf("§7Beds Broken: §a3", "§cRED: §f3", "§7Emeralds in §a2:00"),
            bedwars = ModeContext.MATCH,
            resolvedGame = GameMode.BEDWARS,
            resolvedContext = ModeContext.MATCH,
        ),
        // ---- SkyWars ------------------------------------------------------------
        SidebarCase(
            name = "SKYWARS hub / Coins and Tokens",
            title = "§b§lSKYWARS",
            lines = listOf("§7Coins: §f100", "§7Tokens: §f5", "§7Soul Well"),
        ),
        SidebarCase(
            name = "SKYWARS pregame lobby",
            title = "§b§lSKYWARS",
            lines = listOf("§7Starting in §a0:20", "§7Players: §f8/12", "§7Mode: Normal"),
            skywars = ModeContext.LOBBY,
            resolvedGame = GameMode.SKYWARS,
            resolvedContext = ModeContext.LOBBY,
        ),
        SidebarCase(
            name = "SKYWARS match",
            title = "§b§lSKYWARS",
            lines = listOf("§7Players Left: §a3", "§7Kills: §f1"),
            skywars = ModeContext.MATCH,
            resolvedGame = GameMode.SKYWARS,
            resolvedContext = ModeContext.MATCH,
        ),
        // ---- Duels --------------------------------------------------------------
        SidebarCase(
            name = "DUELS hub / season line only",
            title = "§e§lDUELS",
            lines = listOf("§7Season 1"),
        ),
        SidebarCase(
            name = "DUELS pregame lobby",
            title = "§e§lDUELS",
            lines = listOf("§7Starting in §a0:20", "§7Players: §f2", "§7Mode: Sumo"),
            duels = ModeContext.LOBBY,
            resolvedGame = GameMode.DUELS,
            resolvedContext = ModeContext.LOBBY,
        ),
        SidebarCase(
            name = "DUELS sumo match",
            title = "§e§lDUELS",
            lines = listOf("§7Mode: §aSumo", "§7Opponent: §fRival", "§7Time Left: §a2:31"),
            duels = ModeContext.MATCH,
            resolvedGame = GameMode.DUELS,
            resolvedContext = ModeContext.MATCH,
        ),
        SidebarCase(
            name = "DUELS main lobby / win counters",
            title = "§e§lDUELS",
            lines = listOf("§7Wins: §f10", "§7Losses: §f5", "§7Coins: §f100"),
            duels = ModeContext.LOBBY,
            resolvedGame = GameMode.DUELS,
            resolvedContext = ModeContext.LOBBY,
        ),
        SidebarCase(
            name = "BEDWARS sidebar / 'Mode: Duels' line",
            title = "§e§lBED WARS",
            lines = listOf("§7Mode: §aDuels", "§7Beds: §f2", "§7Beds Broken: §a1"),
            bedwars = ModeContext.LOBBY,
            resolvedGame = GameMode.BEDWARS,
            resolvedContext = ModeContext.LOBBY,
        ),
        // ---- Cross-game ---------------------------------------------------------
        SidebarCase(
            name = "generic HYPIXEL lobby",
            title = "§a§lHYPIXEL",
            lines = listOf("§7Coins: §f123", "§7Level: §f12"),
            titleGeneric = true,
        ),
    )

    @Test
    fun `sidebar fixtures classify to the expected game context`() {
        sidebarCases.forEach { case ->
            val evidence = ModeClassifier.classify(case.title, case.lines)

            assertEquals(case.bedwars, evidence.bedwars, "case: ${case.name} / bedwars")
            assertEquals(case.skywars, evidence.skywars, "case: ${case.name} / skywars")
            assertEquals(case.duels, evidence.duels, "case: ${case.name} / duels")
            assertEquals(case.resolvedGame, evidence.resolvedGame, "case: ${case.name} / resolved game")
            assertEquals(
                case.resolvedContext,
                evidence.resolvedContext,
                "case: ${case.name} / resolved context",
            )
            case.titleGeneric?.let {
                assertEquals(it, evidence.titleGeneric, "case: ${case.name} / titleGeneric")
            }
        }
    }

    @Test
    fun `pregame to match transition with the same line count is reclassified`() {
        val pregame = ModeClassifier.classify(
            "§e§lBED WARS",
            listOf("§7Players: 4/16", "§7Waiting for players...", "§7Mode: Solo"),
        )
        assertEquals(ModeContext.LOBBY, pregame.bedwars, "case: pregame sample")

        val match = ModeClassifier.classify(
            "§e§lBED WARS",
            listOf("§7Players: 4/16", "§cRED: §f3", "§7Beds Broken: §a3"),
        )
        // Same title, same line count: the old cache key could not see this.
        assertEquals(ModeContext.MATCH, match.bedwars, "case: match sample after pregame")
    }

    @Test
    fun `chat lines map to the expected signal`() {
        val cases = listOf(
            ChatCase(
                name = "BEDWARS intro",
                gameMode = GameMode.BEDWARS,
                message = "protect your bed and destroy the enemy beds!",
                expected = ChatSignal.Detect(ModeContext.MATCH),
            ),
            ChatCase(
                name = "bare bedwars word in the lobby",
                gameMode = GameMode.BEDWARS,
                message = "welcome to the bedwars lobby",
                expected = ChatSignal.None,
            ),
            ChatCase(
                name = "DUELS sees a bedwars signal",
                gameMode = GameMode.DUELS,
                message = "your bed was destroyed",
                expected = ChatSignal.Clear,
            ),
            ChatCase(
                name = "SKYWARS sees a duels signal",
                gameMode = GameMode.SKYWARS,
                message = "sumo duel starting",
                expected = ChatSignal.Clear,
            ),
            ChatCase(
                name = "DUELS opponent line",
                gameMode = GameMode.DUELS,
                message = "opponent: rival",
                expected = ChatSignal.Detect(ModeContext.MATCH),
            ),
            ChatCase(
                name = "SKYWARS cages-open line",
                gameMode = GameMode.SKYWARS,
                message = "cages open in 5 seconds",
                expected = ChatSignal.Detect(ModeContext.MATCH),
            ),
        )

        cases.forEach { case ->
            assertEquals(
                case.expected,
                ModeClassifier.chatSignal(case.gameMode, case.message, case.cachedContextActive),
                "case: ${case.name} (${case.gameMode})",
            )
        }
    }
}
