package club.sk1er.mods.levelhead.commands

import club.sk1er.mods.levelhead.Levelhead
import club.sk1er.mods.levelhead.bedwars.BedwarsFetcher
import club.sk1er.mods.levelhead.bedwars.FetchResult
import club.sk1er.mods.levelhead.config.LevelheadConfig
import club.sk1er.mods.levelhead.core.BedwarsStar
import club.sk1er.mods.levelhead.core.dashUUID
import cc.polyfrost.oneconfig.utils.commands.annotations.Command
import cc.polyfrost.oneconfig.utils.commands.annotations.Greedy
import cc.polyfrost.oneconfig.utils.commands.annotations.Main
import com.google.gson.JsonObject
import net.minecraft.client.Minecraft
import net.minecraft.util.ChatComponentText
import net.minecraft.util.EnumChatFormatting as ChatColor
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import net.minecraft.entity.player.EntityPlayer
import okhttp3.HttpUrl
import okhttp3.Request
import java.util.Locale
import java.util.UUID
import kotlin.coroutines.resume

/**
 * Standalone /whois command that is an alias for /levelhead whois.
 * Allows users to quickly look up player stats without typing the full command.
 */
@Command(value = "whois")
class WhoisCommand {

    companion object {
        private val UUID_WITH_DASH_PATTERN = Regex("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", RegexOption.IGNORE_CASE)
        private val UUID_NO_DASH_PATTERN = Regex("^[0-9a-f]{32}$", RegexOption.IGNORE_CASE)
        private val IGN_PATTERN = Regex("^[a-zA-Z0-9_]{1,16}$")
    }

    @Main
    fun handle(@Greedy identifier: String = "") {
        val trimmedIdentifier = identifier.trim()
        if (trimmedIdentifier.isEmpty()) {
            sendMessage(
                "${ChatColor.RED}Tell me who to inspect.${ChatColor.YELLOW} Run ${ChatColor.GOLD}/whois <player|uuid>${ChatColor.YELLOW} using an in-game name, UUID, or someone nearby."
            )
            return
        }

        val currentGameMode = Levelhead.displayManager.primaryDisplay()?.config?.gameMode?.displayName ?: "BedWars"
        sendMessage("${ChatColor.YELLOW}Looking up $currentGameMode stats for ${ChatColor.GOLD}$trimmedIdentifier${ChatColor.YELLOW}...")
        Levelhead.scope.launch {
            try {
                val result = lookupWhois(trimmedIdentifier)
                Minecraft.getMinecraft().addScheduledTask {
                    val starText = result.star?.let { "${ChatColor.GOLD}$it✪" } ?: "${ChatColor.RED}?"
                    val experienceText = result.experience?.let { "${ChatColor.GOLD}$it" } ?: "${ChatColor.GRAY}unknown"
                    val nickedText = if (result.nicked) " ${ChatColor.GRAY}(nicked)" else ""
                    sendMessage(
                        "${ChatColor.YELLOW}${result.displayName}$nickedText ${ChatColor.YELLOW}is $starText ${ChatColor.YELLOW}(${ChatColor.AQUA}${result.source}${ChatColor.YELLOW}, XP: $experienceText)"
                    )
                }
            } catch (ex: CommandException) {
                Minecraft.getMinecraft().addScheduledTask {
                    sendMessage("${ChatColor.RED}${ex.message}")
                }
            } catch (throwable: Throwable) {
                Levelhead.logger.error("Failed to resolve stats for {}", identifier, throwable)
                Minecraft.getMinecraft().addScheduledTask {
                    sendMessage("${ChatColor.RED}Unexpected error while fetching stats. Check logs for details.")
                }
            }
        }
    }

    private fun sendMessage(message: String) {
        val minecraft = Minecraft.getMinecraft()
        val formatted = "${ChatColor.AQUA}[Levelhead] ${ChatColor.RESET}$message"
        minecraft.addScheduledTask {
            minecraft.thePlayer?.addChatMessage(ChatComponentText(formatted))
        }
    }

    private suspend fun lookupWhois(identifier: String): WhoisResult {
        return if (isProxyFullyConfigured()) {
            fetchWhoisFromProxy(identifier)
        } else {
            val resolved = resolvePlayerIdentifier(identifier)
                ?: throw CommandException("Could not resolve '$identifier' to a player UUID.")
            fetchWhoisFromHypixel(resolved)
        }
    }

    private fun isProxyFullyConfigured(): Boolean {
        return LevelheadConfig.proxyEnabled && LevelheadConfig.proxyBaseUrl.isNotBlank() && LevelheadConfig.proxyAuthToken.isNotBlank()
    }

    private suspend fun fetchWhoisFromProxy(identifier: String): WhoisResult = withContext(Dispatchers.IO) {
        Levelhead.rateLimiter.consume()
        when (val result = BedwarsFetcher.fetchProxyPlayer(identifier, null)) {
            is FetchResult.Success -> parseWhoisResult(result.payload, identifier, source = "proxy")
            FetchResult.NotModified -> throw CommandException("Proxy returned no updates for $identifier.")
            is FetchResult.TemporaryError -> throw CommandException("Proxy temporarily unavailable (${result.reason ?: "unknown"}).")
            is FetchResult.PermanentError -> throw CommandException(
                when (result.reason) {
                    "PROXY_DISABLED" -> "Proxy is disabled. Configure it or use a UUID."
                    else -> "Proxy rejected the request (${result.reason ?: "unknown"})."
                }
            )
        }
    }

    private suspend fun fetchWhoisFromHypixel(resolved: ResolvedIdentifier): WhoisResult = withContext(Dispatchers.IO) {
        Levelhead.rateLimiter.consume()
        when (val result = BedwarsFetcher.fetchPlayer(resolved.uuid, null)) {
            is FetchResult.Success -> parseWhoisResult(result.payload, resolved.displayName ?: resolved.uuid.toString(), source = "hypixel")
            FetchResult.NotModified -> throw CommandException("No fresh data available for ${resolved.displayName ?: resolved.uuid}.")
            is FetchResult.TemporaryError -> throw CommandException("Hypixel temporarily unavailable (${result.reason ?: "unknown"}).")
            is FetchResult.PermanentError -> throw CommandException(
                when (result.reason) {
                    "MISSING_KEY" -> "Set your Hypixel API key with /levelhead apikey <key> to query players."
                    else -> "Hypixel request failed (${result.reason ?: "unknown"})."
                }
            )
        }
    }

    private fun parseWhoisResult(payload: JsonObject, fallbackName: String, source: String): WhoisResult {
        val experience = BedwarsStar.extractExperience(payload)
        val star = experience?.let { BedwarsStar.calculateStar(it) }
        val nicked = payload.get("nicked")?.asBoolean == true
        val displayName = payload.get("display")?.asString
            ?: payload.getAsJsonObject("player")?.get("displayname")?.asString
            ?: fallbackName
        return WhoisResult(displayName = displayName, star = star, experience = experience, nicked = nicked, source = source)
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
            UUID_WITH_DASH_PATTERN.matches(trimmed) -> {
                return runCatching { UUID.fromString(trimmed) }.map { ResolvedIdentifier(it, null) }.getOrNull()
            }
            UUID_NO_DASH_PATTERN.matches(trimmed) -> {
                val uuid = trimmed.lowercase(Locale.ROOT).dashUUID
                if (uuid != null) {
                    return ResolvedIdentifier(uuid, null)
                }
            }
            IGN_PATTERN.matches(trimmed) -> {
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
            val json = runCatching { Levelhead.jsonParser.parse(body).asJsonObject }.getOrNull() ?: return@withContext null
            val id = json.get("id")?.asString ?: return@withContext null
            val uuid = id.dashUUID ?: return@withContext null
            val name = json.get("name")?.asString ?: ign
            uuid to name
        }
    }

    private data class WhoisResult(
        val displayName: String,
        val star: Int?,
        val experience: Long?,
        val nicked: Boolean,
        val source: String,
    )

    private data class ResolvedIdentifier(val uuid: UUID, val displayName: String?)

    private class CommandException(message: String) : Exception(message)
}
