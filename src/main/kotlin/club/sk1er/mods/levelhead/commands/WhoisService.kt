package club.sk1er.mods.levelhead.commands

import club.sk1er.mods.levelhead.Levelhead
import club.sk1er.mods.levelhead.bedwars.FetchResult
import club.sk1er.mods.levelhead.core.StatsFetcher
import club.sk1er.mods.levelhead.core.GameMode
import club.sk1er.mods.levelhead.core.GameStats
import club.sk1er.mods.levelhead.core.ModeManager
import club.sk1er.mods.levelhead.core.dashUUID
import club.sk1er.mods.levelhead.duels.DuelsStats
import club.sk1er.mods.levelhead.skywars.SkyWarsStats
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import net.minecraft.client.Minecraft
import net.minecraft.entity.player.EntityPlayer
import net.minecraft.util.EnumChatFormatting as ChatColor
import okhttp3.HttpUrl
import okhttp3.Request
import java.util.Locale
import java.util.UUID
import kotlin.coroutines.resume

object WhoisService {

    suspend fun lookupWhois(identifier: String): WhoisResult {
        val resolved = resolvePlayerIdentifier(identifier)
            ?: throw CommandException("Could not resolve '$identifier' to a player UUID.")
        
        val gameMode = ModeManager.getActiveGameMode() ?: GameMode.BEDWARS
        
        return fetchWhois(resolved, gameMode)
    }

    suspend fun lookupWhoisMessage(identifier: String): String {
        val result = lookupWhois(identifier)
        return formatResultMessage(result)
    }

    private suspend fun fetchWhois(resolved: ResolvedIdentifier, gameMode: GameMode): WhoisResult = withContext(Dispatchers.IO) {
        Levelhead.rateLimiter.consume()
        
        when (val result = StatsFetcher.fetchPlayer(resolved.uuid, gameMode)) {
            is FetchResult.Success -> {
                val stats = StatsFetcher.buildGameStats(result.payload, gameMode, result.etag)
                parseWhoisResult(result.payload, stats, resolved.displayName ?: resolved.uuid.toString(), gameMode)
            }
            FetchResult.NotModified -> throw CommandException("No fresh data available for ${resolved.displayName ?: resolved.uuid}.")
            is FetchResult.TemporaryError -> throw CommandException("${gameMode.displayName} stats temporarily unavailable (${result.reason ?: "unknown"}).")
            is FetchResult.PermanentError -> throw CommandException(
                when (result.reason) {
                    "MISSING_KEY" -> "Set your Hypixel API key with /levelhead apikey <key> to query players."
                    "OFFLINE_MODE" -> "Mod is in offline mode."
                    else -> "${gameMode.displayName} request failed (${result.reason ?: "unknown"})."
                }
            )
        }
    }

    private fun parseWhoisResult(payload: JsonObject, stats: GameStats?, fallbackName: String, gameMode: GameMode): WhoisResult {
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
            displayName = displayName,
            statValue = statValue,
            statName = primaryStatName,
            nicked = nicked,
            gameMode = gameMode
        )
    }

    private fun formatResultMessage(result: WhoisResult): String {
        val nickedText = if (result.nicked) " ${ChatColor.GRAY}(nicked)" else ""
        return "${ChatColor.YELLOW}${result.displayName}$nickedText ${ChatColor.YELLOW}is ${ChatColor.GOLD}${result.statValue} " +
            "${ChatColor.YELLOW}(${result.gameMode.displayName} ${result.statName})"
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

        Levelhead.okHttpClient.newCall(request).execute().use { response ->
            if (!response.isSuccessful) {
                if (response.code() == 204 || response.code() == 404) {
                    return@withContext null
                }
                throw CommandException("Mojang profile lookup failed with HTTP ${response.code()}.")
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
        val displayName: String,
        val statValue: String,
        val statName: String,
        val nicked: Boolean,
        val gameMode: GameMode,
    )

    data class ResolvedIdentifier(val uuid: UUID, val displayName: String?)

    class CommandException(message: String) : Exception(message)

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
