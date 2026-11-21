package club.sk1er.mods.levelhead.commands

import club.sk1er.mods.levelhead.Levelhead
import club.sk1er.mods.levelhead.bedwars.FetchResult
import club.sk1er.mods.levelhead.core.BedwarsStar
import club.sk1er.mods.levelhead.core.StatsFetcher
import club.sk1er.mods.levelhead.core.GameMode
import club.sk1er.mods.levelhead.core.GameStats
import club.sk1er.mods.levelhead.core.ModeManager
import club.sk1er.mods.levelhead.core.StatsLookup
import club.sk1er.mods.levelhead.core.await
import club.sk1er.mods.levelhead.core.dashUUID
import club.sk1er.mods.levelhead.duels.DuelsStats
import club.sk1er.mods.levelhead.skywars.SkyWarsStats
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import net.minecraft.client.Minecraft
import net.minecraft.util.ChatComponentText
import net.minecraft.util.IChatComponent
import net.minecraft.util.EnumChatFormatting as ChatColor
import okhttp3.HttpUrl
import okhttp3.Request
import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import java.util.Locale
import java.util.UUID
import kotlin.coroutines.resume

object WhoisService {

    suspend fun lookupWhois(identifier: String, gameMode: GameMode? = null): WhoisResult {
        val resolved = resolvePlayerIdentifier(identifier)
            ?: throw CommandException(
                "Could not resolve '$identifier' to a player UUID.",
                CommandUtils.buildInteractiveFeedback(
                    messagePrefix = "${ChatColor.RED}Could not resolve '$identifier'.${ChatColor.YELLOW} Try ",
                    command = "/levelhead whois <player> [bw|duels|sw]",
                    run = false,
                    suggestedCommand = "/levelhead whois ",
                    suffix = "${ChatColor.YELLOW} with a valid name or UUID.",
                    hoverTextOverride = "${ChatColor.GREEN}Click to fill whois command"
                )
            )

        val resolvedMode = gameMode ?: ModeManager.getActiveGameMode() ?: GameMode.BEDWARS

        return fetchWhois(resolved, resolvedMode)
    }

    suspend fun lookupWhoisComponent(identifier: String, gameMode: GameMode? = null): IChatComponent {
        val result = lookupWhois(identifier, gameMode)
        return formatSummaryLine(result)
    }

    suspend fun runWhoisCommand(
        identifier: String,
        hintCommand: String = "/whois <player|uuid> [bw|duels|sw]",
        hintSuggestion: String = "/whois "
    ) {
        val trimmed = identifier.trim()
        if (trimmed.isEmpty()) {
            CommandUtils.sendPrefixedChat(
                CommandUtils.buildInteractiveFeedback(
                    messagePrefix = "${ChatColor.RED}Tell me who to inspect.${ChatColor.YELLOW} Try ",
                    command = hintCommand,
                    suggestedCommand = hintSuggestion,
                    run = false,
                    suffix = "${ChatColor.YELLOW} using an in-game name, UUID, or someone nearby.",
                    hoverTextOverride = "${ChatColor.GREEN}Click to fill whois command"
                )
            )
            return
        }

        val input = parseWhoisInput(trimmed)
        CommandUtils.sendPrefixedChat(
            ChatComponentText("${ChatColor.YELLOW}Looking up stats for ${ChatColor.GOLD}${input.query}${ChatColor.YELLOW}...")
        )
        try {
            val result = lookupWhois(input.query, input.gameMode)
            formatResultLines(result).forEach { CommandUtils.sendPrefixedChat(it) }
        } catch (ex: CommandException) {
            CommandUtils.sendPrefixedChat(ex.component ?: ChatComponentText("${ChatColor.RED}${ex.message}"))
        } catch (throwable: Throwable) {
            if (throwable is kotlinx.coroutines.CancellationException) throw throwable
            Levelhead.logger.error("Failed to resolve stats for {}", trimmed, throwable)
            CommandUtils.sendPrefixedChat(FetchFeedback.unexpectedErrorFeedback("fetching stats"))
        }
    }

    private suspend fun fetchWhois(resolved: ResolvedIdentifier, gameMode: GameMode): WhoisResult = withContext(Dispatchers.IO) {
        // Whois shares the display cache: a tag already fetched for the same
        // player/mode answers without spending a rate-limit token. Only fresh
        // entries qualify; stale data must go back to the backend.
        if (Levelhead.statsStore.lookup(resolved.uuid, gameMode) == StatsLookup.HIT) {
            Levelhead.statsStore.get(resolved.uuid, gameMode)?.let { cached ->
                return@withContext createWhoisResult(
                    uuid = resolved.uuid,
                    displayName = resolved.displayName ?: resolved.uuid.toString(),
                    stats = cached,
                    gameMode = gameMode,
                    nicked = cached.nicked
                )
            }
        }

        if (!Levelhead.rateLimiter.tryAcquire()) {
            throw CommandException(
                "Stats requests are paused by the rate limit.",
                CommandUtils.buildInteractiveFeedback(
                    messagePrefix = "${ChatColor.RED}Stats requests are paused by the rate limit.${ChatColor.YELLOW} Try again in a moment or check ",
                    command = "/levelhead status",
                    run = true,
                    suffix = "${ChatColor.YELLOW}.",
                    hoverTextOverride = "${ChatColor.GREEN}Click to check status"
                )
            )
        }

        when (val result = StatsFetcher.fetchPlayer(resolved.uuid, gameMode)) {
            is FetchResult.Success -> {
                val stats = StatsFetcher.buildGameStats(result.payload, gameMode)
                if (stats != null) {
                    Levelhead.statsStore.putSuccess(resolved.uuid, gameMode, stats)
                }
                parseWhoisResult(result.payload, stats, resolved.displayName ?: resolved.uuid.toString(), gameMode, resolved.uuid)
            }
            is FetchResult.TemporaryError -> {
                throw CommandException(
                    "${gameMode.displayName} stats temporarily unavailable (${result.reason ?: "unknown"}).",
                    FetchFeedback.temporaryErrorFeedback(result.reason, gameMode.displayName)
                )
            }
            is FetchResult.PermanentError -> {
                throw CommandException(
                    when (result.reason) {
                        "OFFLINE_MODE" -> "The stats backend is unreachable."
                        else -> "${gameMode.displayName} request failed (${result.reason ?: "unknown"})."
                    },
                    FetchFeedback.permanentErrorFeedback(result.reason, gameMode.displayName)
                )
            }
        }
    }

    private fun parseWhoisResult(payload: JsonObject, stats: GameStats?, fallbackName: String, gameMode: GameMode, uuid: UUID): WhoisResult {
        val displayName = payload.stringValue("display")
            ?: payload.stringValue("displayname")
            ?: payload.jsonObject("player")?.stringValue("displayname")
            ?: fallbackName
        val nicked = (stats?.nicked == true) ||
            payload.booleanValue("nicked") == true ||
            displayName.equals("(nicked)", ignoreCase = true)

        return createWhoisResult(uuid, displayName, stats, gameMode, nicked)
    }

    private fun createWhoisResult(
        uuid: UUID,
        displayName: String,
        stats: GameStats?,
        gameMode: GameMode,
        nicked: Boolean
    ): WhoisResult {
        return WhoisResult(
            uuid = uuid,
            displayName = displayName,
            stats = stats,
            nicked = nicked,
            gameMode = gameMode
        )
    }

    private fun formatResultLines(result: WhoisResult): List<IChatComponent> {
        return listOf(formatSummaryLine(result), formatLinkLine(result))
    }

    private fun formatSummaryLine(result: WhoisResult): IChatComponent {
        val line = ChatComponentText("")
        line.appendSibling(
            CommandUtils.createClickableCommand(
                "/levelhead whois ${result.displayName}",
                run = false,
                displayText = "${ChatColor.YELLOW}${result.displayName}",
                hoverTextOverride = "${ChatColor.GREEN}Click to fill /levelhead whois ${result.displayName}"
            )
        )

        val alreadySuffixed = result.displayName.trim().equals("(nicked)", ignoreCase = true)
        if (result.nicked && !alreadySuffixed) {
            line.appendSibling(styled(" (nicked)", ChatColor.GRAY))
        }

        when (result.gameMode) {
            GameMode.BEDWARS -> appendBedwarsSummary(line, result.stats as? GameStats.Bedwars)
            GameMode.DUELS -> appendDuelsSummary(line, result.stats as? GameStats.Duels)
            GameMode.SKYWARS -> appendSkyWarsSummary(line, result.stats as? GameStats.SkyWars)
        }
        return line
    }

    private fun appendBedwarsSummary(line: IChatComponent, stats: GameStats.Bedwars?) {
        val star = stats?.star
        val icon = stats?.starIcon ?: star?.let { BedwarsStar.getPrestigeIcon(it) }
        val starText = if (star != null) "[$star${icon ?: ""}]" else "?"
        line.appendSibling(styled(" $starText", ChatColor.LIGHT_PURPLE))
        appendSeparator(line)
        line.appendSibling(styled("FKDR ", ChatColor.GRAY))
        line.appendSibling(styled(formatRatio(stats?.fkdr), ChatColor.GOLD))
    }

    private fun appendDuelsSummary(line: IChatComponent, stats: GameStats.Duels?) {
        val wins = stats?.wins
        val losses = stats?.losses
        appendSeparator(line)
        line.appendSibling(divisionComponent(wins?.let { DuelsStats.getOverallDivisionInfo(it) }))
        appendSeparator(line)
        line.appendSibling(styled("${wins ?: "?"}W / ${losses ?: "?"}L", ChatColor.WHITE))
        line.appendSibling(styled(" (", ChatColor.GRAY))
        line.appendSibling(styled(formatRatio(DuelsStats.calculateWLR(wins, losses)), ChatColor.GOLD))
        line.appendSibling(styled(" WLR)", ChatColor.GRAY))
        appendSeparator(line)
        line.appendSibling(styled(formatRatio(DuelsStats.calculateKDR(stats?.kills, stats?.deaths)), ChatColor.GOLD))
        line.appendSibling(styled(" KDR", ChatColor.GRAY))
    }

    private fun appendSkyWarsSummary(line: IChatComponent, stats: GameStats.SkyWars?) {
        val level = stats?.level?.toInt()
        val levelText = level?.let { "$it${SkyWarsStats.getDefaultEmblem(it)}" } ?: "?"
        val wins = stats?.wins
        val losses = stats?.losses
        appendSeparator(line)
        line.appendSibling(styled(levelText, ChatColor.AQUA))
        appendSeparator(line)
        line.appendSibling(styled("${wins ?: "?"}W / ${losses ?: "?"}L", ChatColor.WHITE))
        line.appendSibling(styled(" (", ChatColor.GRAY))
        line.appendSibling(styled(formatRatio(SkyWarsStats.calculateWLR(wins, losses)), ChatColor.GOLD))
        line.appendSibling(styled(" WLR)", ChatColor.GRAY))
        appendSeparator(line)
        line.appendSibling(styled(formatRatio(SkyWarsStats.calculateKDR(stats?.kills, stats?.deaths)), ChatColor.GOLD))
        line.appendSibling(styled(" KDR", ChatColor.GRAY))
    }

    private fun formatLinkLine(result: WhoisResult): IChatComponent {
        val line = ChatComponentText("")
        line.appendSibling(
            CommandUtils.createClickableUrl(
                "https://namemc.com/profile/${result.uuid}",
                "${ChatColor.AQUA}NameMC",
                hoverTextOverride = "${ChatColor.GREEN}Open NameMC profile for ${result.displayName}"
            )
        )
        appendSeparator(line)
        line.appendSibling(
            CommandUtils.createClickableUrl(
                "https://plancke.io/hypixel/player/stats/${result.displayName.encodeForUrl()}",
                "${ChatColor.AQUA}Plancke",
                hoverTextOverride = "${ChatColor.GREEN}Open Plancke stats for ${result.displayName}"
            )
        )
        return line
    }

    private fun divisionComponent(info: DuelsStats.OverallDivisionInfo?): IChatComponent {
        return ChatComponentText(info?.displayName ?: "?").apply {
            chatStyle.setColor(ChatColor.GOLD)
            chatStyle.setBold(info?.bold == true)
        }
    }

    private fun appendSeparator(line: IChatComponent) {
        line.appendSibling(styled(" · ", ChatColor.DARK_GRAY))
    }

    private fun styled(text: String, color: ChatColor): ChatComponentText {
        return ChatComponentText(text).apply { chatStyle.setColor(color) }
    }

    private fun formatRatio(value: Double?): String {
        return value?.let { String.format(Locale.ROOT, "%.2f", it) } ?: "?"
    }

    private fun String.encodeForUrl(): String {
        return URLEncoder.encode(this, StandardCharsets.UTF_8.name())
    }

    private fun parseWhoisInput(input: String): WhoisInput {
        val trimmed = input.trim()
        val lastSpace = trimmed.lastIndexOf(' ')
        if (lastSpace <= 0) {
            return WhoisInput(trimmed, null)
        }
        val token = trimmed.substring(lastSpace + 1).lowercase(Locale.ROOT)
        val mode = whoisModeTokens[token] ?: return WhoisInput(trimmed, null)
        val query = trimmed.substring(0, lastSpace).trim()
        if (query.isEmpty()) {
            return WhoisInput(trimmed, null)
        }
        return WhoisInput(query, mode)
    }

    private suspend fun resolvePlayerIdentifier(input: String): ResolvedIdentifier? {
        val trimmed = input.trim()
        if (trimmed.isEmpty()) {
            return null
        }

        val localMatch = resolveLocalPlayer(trimmed)
        if (localMatch != null) {
            return localMatch
        }

        when {
            PlayerIdentifiers.UUID_WITH_DASH_PATTERN.matches(trimmed) -> {
                return runCatching { UUID.fromString(trimmed) }.map { ResolvedIdentifier(it, null) }.getOrNull()
            }
            PlayerIdentifiers.UUID_NO_DASH_PATTERN.matches(trimmed) -> {
                val uuid = trimmed.lowercase(Locale.ROOT).dashUUID
                if (uuid != null) {
                    return ResolvedIdentifier(uuid, null)
                }
            }
            PlayerIdentifiers.IGN_PATTERN.matches(trimmed) -> {
                val resolved = lookupUuidForIgn(trimmed)
                if (resolved != null) {
                    return ResolvedIdentifier(resolved.first, resolved.second)
                }
            }
        }
        return null
    }

    private suspend fun resolveLocalPlayer(trimmed: String): ResolvedIdentifier? = suspendCancellableCoroutine { continuation ->
        val minecraft = Minecraft.getMinecraft()

        minecraft.addScheduledTask {
            val worldMatch = Minecraft.getMinecraft().theWorld
                ?.playerEntities
                ?.firstOrNull { player ->
                    player.name.equals(trimmed, true) || player.gameProfile?.name?.equals(trimmed, true) == true
                }
            val match = if (worldMatch != null) {
                ResolvedIdentifier(worldMatch.uniqueID, worldMatch.name)
            } else {
                // Tab-list players outside entity range still have a known UUID.
                Minecraft.getMinecraft().thePlayer
                    ?.sendQueue
                    ?.getPlayerInfoMap()
                    ?.firstOrNull { info -> info.gameProfile?.name?.equals(trimmed, true) == true }
                    ?.gameProfile
                    ?.let { ResolvedIdentifier(it.id, it.name) }
            }
            if (continuation.isActive) {
                continuation.resume(match)
            }
        }
    }

    private suspend fun lookupUuidForIgn(ign: String): Pair<UUID, String>? = withContext(Dispatchers.IO) {
        val url = HttpUrl.parse("https://api.mojang.com/users/profiles/minecraft/$ign")
            ?: return@withContext null
        val request = Request.Builder()
            .url(url)
            .header("User-Agent", "Levelhead/${Levelhead.VERSION}")
            .header("Accept", "application/json")
            .get()
            .build()

        Levelhead.okHttpClient.newCall(request).await().use { response ->
            if (!response.isSuccessful) {
                if (response.code() == 204 || response.code() == 404) {
                    return@withContext null
                }
                val baseError = "Mojang profile lookup failed with HTTP ${response.code()}"
                throw CommandException(
                    "$baseError.",
                    CommandUtils.buildInteractiveFeedback(
                        messagePrefix = "${ChatColor.RED}$baseError.${ChatColor.YELLOW} Check spelling or try ",
                        command = "/levelhead whois <player> [bw|duels|sw]",
                        run = false,
                        suggestedCommand = "/levelhead whois ",
                        suffix = "${ChatColor.YELLOW} again.",
                        hoverTextOverride = "${ChatColor.GREEN}Click to fill whois command"
                    )
                )
            }
            val body = response.body()?.string().orEmpty()
            if (body.isEmpty()) {
                return@withContext null
            }
            val json = runCatching { JsonParser.parseString(body).asJsonObject }.getOrNull() ?: return@withContext null
            val id = json.get("id")?.asString ?: return@withContext null
            val uuid = id.dashUUID ?: return@withContext null
            val name = json.get("name")?.asString ?: ign
            uuid to name
        }
    }

    data class WhoisResult(
        val uuid: UUID,
        val displayName: String,
        val stats: GameStats?,
        val nicked: Boolean,
        val gameMode: GameMode,
    )

    data class ResolvedIdentifier(val uuid: UUID, val displayName: String?)

    private data class WhoisInput(val query: String, val gameMode: GameMode?)

    private val whoisModeTokens: Map<String, GameMode> = mapOf(
        "bw" to GameMode.BEDWARS,
        "bedwars" to GameMode.BEDWARS,
        "duels" to GameMode.DUELS,
        "sw" to GameMode.SKYWARS,
        "skywars" to GameMode.SKYWARS
    )

    class CommandException(message: String, val component: IChatComponent? = null) : Exception(message)

    private fun JsonObject.booleanValue(key: String): Boolean? {
        val element = get(key) ?: return null
        if (element.isJsonNull) return null
        return runCatching { element.asBoolean }.getOrNull()
    }

    private fun JsonObject.stringValue(key: String): String? {
        val element = get(key) ?: return null
        if (element.isJsonNull) return null
        return runCatching { element.asString }.getOrNull()
    }

    private fun JsonObject.jsonObject(key: String): JsonObject? {
        return get(key)?.takeIf { it.isJsonObject }?.asJsonObject
    }
}
