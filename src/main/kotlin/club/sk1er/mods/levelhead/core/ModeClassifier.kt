package club.sk1er.mods.levelhead.core

import java.util.Locale

enum class ModeContext {
    NONE,
    LOBBY,
    MATCH;

    val isActive: Boolean
        get() = this != NONE
}

data class SidebarEvidence(
    val title: String,
    val normalizedTitle: String,
    val lines: List<String>,
    val titleGeneric: Boolean,
    val bedwars: ModeContext,
    val duels: ModeContext,
    val skywars: ModeContext
) {
    fun contextOf(gameMode: GameMode): ModeContext = when (gameMode) {
        GameMode.BEDWARS -> bedwars
        GameMode.DUELS -> duels
        GameMode.SKYWARS -> skywars
    }

    val resolvedGame: GameMode?
        get() = when {
            duels == ModeContext.MATCH -> GameMode.DUELS
            skywars == ModeContext.MATCH -> GameMode.SKYWARS
            bedwars == ModeContext.MATCH -> GameMode.BEDWARS
            duels == ModeContext.LOBBY -> GameMode.DUELS
            skywars == ModeContext.LOBBY -> GameMode.SKYWARS
            bedwars == ModeContext.LOBBY -> GameMode.BEDWARS
            else -> null
        }

    val resolvedContext: ModeContext
        get() = resolvedGame?.let(::contextOf) ?: ModeContext.NONE
}

sealed class ChatSignal {
    object None : ChatSignal()
    data class Detect(val context: ModeContext) : ChatSignal()
    object Clear : ChatSignal()
}

object ModeClassifier {
    private val WHITESPACE = Regex("""\s+""")
    private val COLOR_CODE = Regex("""§[0-9a-fk-orA-FK-OR]""")

    private val bedwarsTeamPattern =
        Regex("""(?:^|\s)(RED|BLUE|GREEN|YELLOW|AQUA|WHITE|PINK|GRAY|GREY)\s*:""", RegexOption.IGNORE_CASE)
    private val bedwarsMiniServerPattern = Regex("""mini\w+""", RegexOption.IGNORE_CASE)
    private val bedwarsIntroPattern =
        Regex("""protect\s+your\s+bed\s+and\s+destroy\s+the\s+enemy\s+beds?""", RegexOption.IGNORE_CASE)

    private val duelsBedwarsChatIndicators = listOf(
        "protect your bed",
        "bed destruction",
        "your bed was",
        "bed was destroyed",
        "bedwars",
        "bed wars",
        "sending you to mini"
    )

    private val duelsSkywarsChatIndicators = listOf(
        "skywars",
        "cages open in",
        "players left:"
    )

    private val skywarsBedwarsChatIndicators = listOf(
        "protect your bed",
        "bed destruction",
        "your bed was",
        "bed was destroyed"
    )

    private val skywarsDuelsChatIndicators = listOf(
        "sumo duel",
        "opponent:",
        "duel -",
        "duels winner",
        "duels killer"
    )

    fun classify(title: String, lines: List<String>): SidebarEvidence {
        val strippedTitle = strip(title)
        val strippedLines = lines.map(::strip).filter { it.isNotBlank() }
        val normalizedTitle = normalizeTitle(strippedTitle)

        val bedwars = classifyBedwars(normalizedTitle, strippedLines)
        val skywars = classifySkywars(normalizedTitle, strippedLines)
        val duels = classifyDuels(normalizedTitle, strippedLines, bedwars, skywars)

        return SidebarEvidence(
            title = strippedTitle,
            normalizedTitle = normalizedTitle,
            lines = strippedLines,
            titleGeneric = isTitleGeneric(normalizedTitle),
            bedwars = bedwars,
            duels = duels,
            skywars = skywars
        )
    }

    fun chatSignal(
        gameMode: GameMode,
        normalizedChat: String,
        cachedContextActive: Boolean
    ): ChatSignal = when (gameMode) {
        GameMode.BEDWARS -> classifyBedwarsChat(normalizedChat, cachedContextActive)
        GameMode.DUELS -> classifyDuelsChat(normalizedChat)
        GameMode.SKYWARS -> classifySkywarsChat(normalizedChat)
    }

    private fun classifyBedwars(normalizedTitle: String, lines: List<String>): ModeContext {
        val hasBedwarsTitle = normalizedTitle.contains("BEDWARS")
        val hasTeamLines = lines.any { bedwarsTeamPattern.containsMatchIn(it) }
        val hasBedwarsIndicators = lines.any { line ->
            val normalizedLine = line.uppercase(Locale.ROOT)
            normalizedLine.contains("BEDS BROKEN") ||
                normalizedLine.contains("FINAL KILLS") ||
                normalizedLine.contains("EMERALDS IN") ||
                normalizedLine.contains("DIAMONDS IN") ||
                normalizedLine.contains("BEDS:")
        }

        // A "BED WARS" title on its own is the BedWars NPC hub, not a game lobby.
        // Treating it as LOBBY fetched ~100 tab players exactly where the public
        // rate limit trips. A real game lobby has pregame lines and no hub lines.
        val hasLobbyLines = lines.any { line ->
            val normalizedLine = line.uppercase(Locale.ROOT)
            normalizedLine.contains("WAITING FOR PLAYERS") ||
                normalizedLine.contains("PLAYERS:") ||
                normalizedLine.contains("MODE:") ||
                normalizedLine.contains("MAP:") ||
                normalizedLine.contains("STARTING IN")
        }
        val hasHubLines = lines.any { line ->
            val normalizedLine = line.uppercase(Locale.ROOT)
            normalizedLine.contains("COINS:") ||
                normalizedLine.contains("LOOT CHEST") ||
                normalizedLine.contains("ACHIEVEMENTS") ||
                normalizedLine.contains("LEVEL:") ||
                normalizedLine.contains("CLICK TO PLAY")
        }

        return when {
            hasTeamLines && (hasBedwarsTitle || hasBedwarsIndicators) -> ModeContext.MATCH
            hasBedwarsIndicators && !hasHubLines -> ModeContext.LOBBY
            hasBedwarsTitle && hasLobbyLines && !hasHubLines -> ModeContext.LOBBY
            else -> ModeContext.NONE
        }
    }

    private fun classifySkywars(normalizedTitle: String, lines: List<String>): ModeContext {
        if (!normalizedTitle.contains("SKYWARS")) return ModeContext.NONE

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

        return if (matchIndicators) {
            ModeContext.MATCH
        } else if (preGameIndicators && !mainLobbyIndicators) {
            ModeContext.LOBBY
        } else {
            ModeContext.NONE
        }
    }

    private fun classifyDuels(
        normalizedTitle: String,
        lines: List<String>,
        bedwars: ModeContext,
        skywars: ModeContext
    ): ModeContext {
        if (normalizedTitle.contains("BEDWARS") || normalizedTitle.contains("SKYWARS")) {
            return ModeContext.NONE
        }

        val isBedwarsDuels = lines.any { line ->
            val normalizedLine = line.uppercase(Locale.ROOT)
            normalizedLine.contains("BED WARS") ||
                normalizedLine.contains("BEDS:") ||
                normalizedLine.contains("BEDS BROKEN") ||
                normalizedLine.contains("FINAL KILLS") ||
                normalizedLine.contains("EMERALDS IN") ||
                normalizedLine.contains("DIAMONDS IN")
        }
        if (isBedwarsDuels) return ModeContext.NONE

        val isDuelScoreboard = normalizedTitle.contains("DUELS") ||
            lines.any { it.contains("Duel", ignoreCase = true) }
        if (!isDuelScoreboard) return ModeContext.NONE

        if (bedwars == ModeContext.MATCH || skywars == ModeContext.MATCH) return ModeContext.NONE

        val matchIndicators = lines.any {
            it.contains("Opponent:", ignoreCase = true) ||
                it.contains("Time Left:", ignoreCase = true) ||
                it.contains("Health:", ignoreCase = true) ||
                it.contains("Round:", ignoreCase = true)
        }
        val preGameIndicators = lines.any {
            it.contains("Starting in", ignoreCase = true) ||
                it.contains("Players:", ignoreCase = true) ||
                it.contains("Mode:", ignoreCase = true)
        }
        val mainLobbyIndicators = lines.any {
            (it.contains("Wins:", ignoreCase = true) && !it.contains("Opponent:", ignoreCase = true)) ||
                it.contains("Losses:", ignoreCase = true) ||
                it.contains("Winstreak", ignoreCase = true) ||
                it.contains("Coins:", ignoreCase = true) ||
                it.contains("Tokens:", ignoreCase = true)
        }

        return when {
            matchIndicators -> ModeContext.MATCH
            preGameIndicators || mainLobbyIndicators -> ModeContext.LOBBY
            else -> ModeContext.NONE
        }
    }

    private fun classifyBedwarsChat(normalized: String, cachedContextActive: Boolean): ChatSignal {
        val hasBedwarsKeyword = normalized.contains("bed wars") || normalized.contains("bedwars")
        val context = when {
            bedwarsIntroPattern.containsMatchIn(normalized) -> ModeContext.MATCH
            (normalized.contains("the game starts in") || normalized.contains("game starts in")) &&
                hasBedwarsKeyword -> ModeContext.MATCH
            // A bare "bedwars" keyword must NOT activate the BedWars LOBBY: it
            // appears in main-lobby/unrelated chat. Real BedWars lobbies are proven
            // by the sidebar, which classifyBedwars() already maps to LOBBY.
            normalized.contains("sending you to mini") && cachedContextActive -> ModeContext.LOBBY
            bedwarsMiniServerPattern.containsMatchIn(normalized) && cachedContextActive -> ModeContext.LOBBY
            else -> ModeContext.NONE
        }
        return if (context == ModeContext.NONE) ChatSignal.None else ChatSignal.Detect(context)
    }

    private fun classifyDuelsChat(normalized: String): ChatSignal {
        val sawBedwarsSignal = duelsBedwarsChatIndicators.any { normalized.contains(it) }
        val sawSkywarsSignal = duelsSkywarsChatIndicators.any { normalized.contains(it) }
        if (sawBedwarsSignal || sawSkywarsSignal) return ChatSignal.Clear
        if (normalized.contains("bed wars duels") || normalized.contains("bedwars duels")) {
            return ChatSignal.Clear
        }

        val context = when {
            normalized.contains("duel starting in") -> ModeContext.MATCH
            normalized.contains("the game starts in") &&
                (normalized.contains("duels") || normalized.contains("duel")) -> ModeContext.MATCH
            normalized.contains("opponent:") -> ModeContext.MATCH
            normalized.contains("you are now queued for") -> ModeContext.LOBBY
            normalized.contains("duels") && normalized.contains("click to play") -> ModeContext.LOBBY
            else -> ModeContext.NONE
        }
        return if (context == ModeContext.NONE) ChatSignal.None else ChatSignal.Detect(context)
    }

    private fun classifySkywarsChat(normalized: String): ChatSignal {
        val sawBedwarsSignal = skywarsBedwarsChatIndicators.any { normalized.contains(it) }
        val sawDuelsSignal = skywarsDuelsChatIndicators.any { normalized.contains(it) }
        if (sawBedwarsSignal || sawDuelsSignal) return ChatSignal.Clear

        val context = when {
            normalized.contains("the game starts in") &&
                normalized.contains("second") &&
                normalized.contains("skywars") -> ModeContext.MATCH
            normalized.contains("cages open in") -> ModeContext.MATCH
            normalized.contains("you died!") && normalized.contains("skywars") -> ModeContext.MATCH
            normalized.contains("skywars") && normalized.contains("click to play") -> ModeContext.LOBBY
            else -> ModeContext.NONE
        }
        return if (context == ModeContext.NONE) ChatSignal.None else ChatSignal.Detect(context)
    }

    private fun isTitleGeneric(normalizedTitle: String): Boolean =
        normalizedTitle == "HYPIXEL" || normalizedTitle == "PROTOTYPE" || normalizedTitle.isBlank()

    private fun normalizeTitle(title: String): String =
        title.uppercase(Locale.ROOT).replace(WHITESPACE, "")

    private fun strip(value: String): String = value.replace(COLOR_CODE, "")
}
