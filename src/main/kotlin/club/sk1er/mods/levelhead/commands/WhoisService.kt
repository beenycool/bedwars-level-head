package club.sk1er.mods.levelhead.commands

import club.sk1er.mods.levelhead.Levelhead
import club.sk1er.mods.levelhead.bedwars.FetchResult
import club.sk1er.mods.levelhead.core.StatsFetcher
import club.sk1er.mods.levelhead.core.GameMode
import club.sk1er.mods.levelhead.core.GameStats
import club.sk1er.mods.levelhead.core.ModeManager
import club.sk1er.mods.levelhead.core.await
import club.sk1er.mods.levelhead.core.dashUUID
import club.sk1er.mods.levelhead.skywars.SkyWarsStats
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import net.minecraft.client.Minecraft
import net.minecraft.util.ChatComponentText
import net.minecraft.entity.player.EntityPlayer
import net.minecraft.util.IChatComponent
import net.minecraft.util.EnumChatFormatting as ChatColor
import okhttp3.HttpUrl
import okhttp3.Request
import java.util.Locale
import java.util.UUID
import kotlin.coroutines.resume

object WhoisService {

    suspend fun lookupWhois(identifier: String): WhoisResult {
        val resolved = resolvePlayerIdentifier(identifier)
            ?: throw CommandException(
                "Could not resolve '$identifier' to a player UUID.",
                CommandUtils.buildInteractiveFeedback(
                    messagePrefix = "${ChatColor.RED}Could not resolve '$identifier'.${ChatColor.YELLOW} Try ",
                    command = "/levelhead whois <player>",
                    run = false,
                    suggestedCommand = "/levelhead whois ",
                    suffix = "${ChatColor.YELLOW} with a valid name or UUID.",
                    hoverTextOverride = "${ChatColor.GREEN}Click to fill whois command"
                )
            )
        
        val gameMode = ModeManager.getActiveGameMode() ?: GameMode.BEDWARS
        
        return fetchWhois(resolved, gameMode)
    }

    suspend fun lookupWhoisComponent(identifier: String): IChatComponent {
        val result = lookupWhois(identifier)
        return formatResultComponent(result)
    }

    /**
     * Shared /whois entry point used by both /whois and /levelhead whois.
     * Sends progress, result and error feedback through [CommandUtils].
     */
    suspend fun runWhoisCommand(
        identifier: String,
        hintCommand: String = "/whois <player|uuid>",
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

        CommandUtils.sendPrefixedChat(
            ChatComponentText("${ChatColor.YELLOW}Looking up stats for ${ChatColor.GOLD}$trimmed${ChatColor.YELLOW}...")
        )
        try {
            CommandUtils.sendPrefixedChat(lookupWhoisComponent(trimmed))
        } catch (ex: CommandException) {
            CommandUtils.sendPrefixedChat(ex.component ?: ChatComponentText("${ChatColor.RED}${ex.message}"))
        } catch (throwable: Throwable) {
            if (throwable is kotlinx.coroutines.CancellationException) throw throwable
            Levelhead.logger.error("Failed to resolve stats for {}", trimmed, throwable)
            CommandUtils.sendPrefixedChat(FetchFeedback.unexpectedErrorFeedback("fetching stats"))
        }
    }

    private suspend fun fetchWhois(resolved: ResolvedIdentifier, gameMode: GameMode): WhoisResult = withContext(Dispatchers.IO) {
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
                val stats = StatsFetcher.buildGameStats(result.payload, gameMode, result.etag)
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

        val statValue = when (stats) {
            is GameStats.Bedwars -> stats.star?.let { "$it✪" } ?: "?"
            is GameStats.Duels -> stats.wins?.toString() ?: "?"
            is GameStats.SkyWars -> stats.level?.let { "$it${SkyWarsStats.getDefaultEmblem(it)}" } ?: "?"
            null -> "?"
        }

        val primaryStatName = when (gameMode) {
            GameMode.BEDWARS -> "Star"
            GameMode.DUELS -> "Wins"
            GameMode.SKYWARS -> "Level"
        }

        return WhoisResult(
            uuid = uuid,
            displayName = displayName,
            statValue = statValue,
            statName = primaryStatName,
            nicked = nicked,
            gameMode = gameMode
        )
    }

    private fun formatResultComponent(result: WhoisResult): IChatComponent {
        val nickedText = if (result.nicked) " ${ChatColor.GRAY}(nicked)" else ""

        val nameComponent = CommandUtils.createClickableCommand(
            result.uuid.toString(),
            run = false,
            displayText = "${ChatColor.YELLOW}${result.displayName}",
            hoverTextOverride = "${ChatColor.GREEN}Click to fill UUID"
        )

        return nameComponent.appendSibling(
            ChatComponentText("$nickedText ${ChatColor.YELLOW}is ${ChatColor.GOLD}${result.statValue} ${ChatColor.YELLOW}(${result.gameMode.displayName} ${result.statName})")
        )
    }

    private suspend fun resolvePlayerIdentifier(input: String): ResolvedIdentifier? {
        val trimmed = input.trim()
        if (trimmed.isEmpty()) {
            return null
        }

        val localMatch = resolveLocalPlayer(trimmed)
        if (localMatch != null) {
            return ResolvedIdentifier(localMatch.uniqueID, localMatch.name)
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

    private suspend fun resolveLocalPlayer(trimmed: String): EntityPlayer? = suspendCancellableCoroutine { continuation ->
        val minecraft = Minecraft.getMinecraft()

        minecraft.addScheduledTask {
            val match = Minecraft.getMinecraft().theWorld
                ?.playerEntities
                ?.firstOrNull { player ->
                    player.name.equals(trimmed, true) || player.gameProfile?.name?.equals(trimmed, true) == true
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
                        command = "/levelhead whois <player>",
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
        val statValue: String,
        val statName: String,
        val nicked: Boolean,
        val gameMode: GameMode,
    )

    data class ResolvedIdentifier(val uuid: UUID, val displayName: String?)

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
